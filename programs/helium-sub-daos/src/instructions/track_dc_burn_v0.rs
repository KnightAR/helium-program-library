use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::Mint;
use shared_utils::{current_epoch, resize_to_fit};
use std::str::FromStr;

pub const DC_KEY: &str = "credacwrBVewZAgCwNgowCSMbCiepuesprUWPBeLTSg";

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct TrackDcBurnArgsV0 {
  pub dc_burned: u64,
  pub bump: u8,
}

#[derive(Accounts)]
#[instruction(args: TrackDcBurnArgsV0)]
pub struct TrackDcBurnV0<'info> {
  #[account(
    init_if_needed,
    payer = account_payer,
    space = std::cmp::max(8 + std::mem::size_of::<SubDaoEpochInfoV0>(), sub_dao_epoch_info.data.borrow_mut().len()),
    seeds = ["sub_dao_epoch_info".as_bytes(), sub_dao.key().as_ref(), &current_epoch(clock.unix_timestamp).to_le_bytes()], // Break into 30m epochs
    bump,
  )]
  pub sub_dao_epoch_info: Box<Account<'info, SubDaoEpochInfoV0>>,
  #[account(
    has_one = dao
  )]
  pub sub_dao: Box<Account<'info, SubDaoV0>>,
  #[account(
    has_one = dc_mint,
  )]
  pub dao: Box<Account<'info, DaoV0>>,
  pub dc_mint: Box<Account<'info, Mint>>,

  #[account(
    mut,
    seeds = ["account_payer".as_bytes()],
    seeds::program = Pubkey::from_str(DC_KEY).unwrap(),
    bump = args.bump,
  )]
  pub account_payer: Signer<'info>, // can't be a HSD PDA because init_if_needed can't be used
  pub system_program: Program<'info, System>,
  pub clock: Sysvar<'info, Clock>,
  pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<TrackDcBurnV0>, args: TrackDcBurnArgsV0) -> Result<()> {
  ctx.accounts.sub_dao_epoch_info.sub_dao = ctx.accounts.sub_dao.key();
  ctx.accounts.sub_dao_epoch_info.dc_burned += args.dc_burned;
  ctx.accounts.sub_dao_epoch_info.bump_seed = *ctx.bumps.get("sub_dao_epoch_info").unwrap();
  ctx.accounts.sub_dao_epoch_info.current_config_version = ctx.accounts.dao.config_version;
  ctx.accounts.sub_dao_epoch_info.epoch = current_epoch(ctx.accounts.clock.unix_timestamp);

  resize_to_fit(
    &ctx.accounts.account_payer.to_account_info(),
    &ctx.accounts.system_program.to_account_info(),
    &ctx.accounts.sub_dao_epoch_info,
  )?;

  Ok(())
}
