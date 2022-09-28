use crate::{state::*, precise_number::{PreciseNumber}, error::ErrorCode, current_epoch, OrArithError};
use anchor_lang::prelude::*;

const DEVICE_ACTIVATION_FEE: u128 = 50;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct CalculateUtilityScoreArgsV0 {
  pub epoch: u64,
}

const TESTING: bool = std::option_env!("TESTING").is_some();



#[derive(Accounts)]
#[instruction(args: CalculateUtilityScoreArgsV0)]
pub struct CalculateUtilityScoreV0<'info> {
  #[account(mut)]
  pub payer: Signer<'info>,
  pub dao: Box<Account<'info, DaoV0>>,
  #[account(
    has_one = dao
  )]
  pub sub_dao: Box<Account<'info, SubDaoV0>>,
  #[account(
    init_if_needed,
    payer = payer,
    space = 60 + 8 + std::mem::size_of::<DaoEpochInfoV0>(),
    seeds = ["dao_epoch_info".as_bytes(), dao.key().as_ref(), &args.epoch.to_le_bytes()], // Break into 30m epochs
    bump,
  )]
  pub dao_epoch_info: Box<Account<'info, DaoEpochInfoV0>>,
  #[account(
    init_if_needed,
    payer = payer,
    space = 60 + 8 + std::mem::size_of::<SubDaoEpochInfoV0>(),
    seeds = ["sub_dao_epoch_info".as_bytes(), sub_dao.key().as_ref(), &args.epoch.to_le_bytes()], // Break into 30m epochs
    bump,
  )]
  pub sub_dao_epoch_info: Box<Account<'info, SubDaoEpochInfoV0>>,
  pub clock: Sysvar<'info, Clock>,
  pub rent: Sysvar<'info, Rent>,
  pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CalculateUtilityScoreV0>, args: CalculateUtilityScoreArgsV0) -> Result<()> {
  let epoch = current_epoch(ctx.accounts.clock.unix_timestamp);
  
  if !TESTING && args.epoch >= epoch {
    return Err(error!(ErrorCode::EpochNotOver));
  }

  if ctx.accounts.sub_dao_epoch_info.utility_score.is_some() {
    return Err(error!(ErrorCode::UtilityScoreAlreadyCalculated));
  }

  ctx.accounts.sub_dao_epoch_info.epoch = epoch;
  ctx.accounts.dao_epoch_info.epoch = epoch;
  ctx.accounts.dao_epoch_info.dao = ctx.accounts.dao.key();
  ctx.accounts.sub_dao_epoch_info.sub_dao = ctx.accounts.sub_dao.key();
  ctx.accounts.sub_dao_epoch_info.bump_seed = *ctx.bumps.get("sub_dao_epoch_info").unwrap();
  ctx.accounts.dao_epoch_info.bump_seed = *ctx.bumps.get("dao_epoch_info").unwrap();

  // Calculate utility score
  // utility score = V * D * A
  // V = max(1, veHNT_dnp). Not implemented yet
  // D = max(1, sqrt(DCs burned in USD)). 1 DC = $0.00001. 
  // A = max(1, sqrt(Total active device count * device activation fee)).
  let epoch_info = &mut ctx.accounts.sub_dao_epoch_info;
  let dc_burned = PreciseNumber::new(epoch_info.dc_burned.into())
    .or_arith_error()?
    .checked_div(&PreciseNumber::new(10000000000000_u128).or_arith_error()?) // DC has 8 decimals, plus 10^5 to get to dollars. 
    .or_arith_error()?;

  let total_devices = PreciseNumber::new(epoch_info.total_devices.into()).or_arith_error()?;
  let devices_with_fee = total_devices.checked_mul(
    &PreciseNumber::new(DEVICE_ACTIVATION_FEE).or_arith_error()?  // TODO: Don't hardcode this
  ).or_arith_error()?;
  let d = std::cmp::max(PreciseNumber::one(), dc_burned.sqrt().or_arith_error()?);
  let a = std::cmp::max(PreciseNumber::one(), devices_with_fee.sqrt().or_arith_error()?);
  let utility_score_prec = d.checked_mul(&a).or_arith_error()?;
  // Convert to u128 with 12 decimals of precision
  let utility_score = utility_score_prec.checked_mul(
    &PreciseNumber::new(1000000000000_u128).or_arith_error()? // u128 with 12 decimal places
  ).or_arith_error()?.to_imprecise().unwrap();

  // Store utility scores
  epoch_info.utility_score = Some(utility_score);
  ctx.accounts.dao_epoch_info.total_utility_score = ctx.accounts.dao_epoch_info.total_utility_score.checked_add(utility_score).unwrap();
  ctx.accounts.dao_epoch_info.num_utility_scores_calculated += 1;

  Ok(())
}
