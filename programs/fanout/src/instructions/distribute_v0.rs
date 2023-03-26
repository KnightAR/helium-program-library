use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::{voucher_seeds, FanoutV0, FanoutVoucherV0};

#[derive(Accounts)]
pub struct DistributeV0<'info> {
  #[account(mut)]
  pub payer: Signer<'info>,

  #[account(
    mut,
    has_one = token_account,
  )]
  pub fanout: Box<Account<'info, FanoutV0>>,

  pub token_account: Box<Account<'info, TokenAccount>>,
  #[account(
    // You can distribute to another account, but only if you're the owner.
    constraint = to_account.owner == owner.key() || owner.is_signer
  )]
  pub owner: UncheckedAccount<'info>,
  #[account(
    mut,
    token::mint = token_account.mint
  )]
  pub to_account: Box<Account<'info, TokenAccount>>,
  #[account(
    seeds = ["fanout_voucher".as_bytes(), mint.key().as_ref()],
    bump = voucher.bump_seed,
    has_one = mint
  )]
  pub voucher: Box<Account<'info, FanoutVoucherV0>>,

  pub mint: Box<Account<'info, Mint>>,
  #[account(
    associated_token::mint = mint,
    associated_token::authority = owner,
    constraint = receipt_account.amount > 0
  )]
  pub receipt_account: Box<Account<'info, TokenAccount>>,
  pub token_program: Program<'info, Token>,
}

impl<'info> DistributeV0<'info> {
  fn transfer_ctx(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
    let cpi_accounts = Transfer {
      from: self.token_account.to_account_info(),
      to: self.to_account.to_account_info(),
      authority: self.voucher.to_account_info(),
    };
    CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
  }
}

const TWELVE_PREC: u128 = 1_000000000000;

pub fn handler(ctx: Context<DistributeV0>) -> Result<()> {
  let curr_balance = ctx.accounts.token_account.amount;
  let inflow = curr_balance
    .checked_sub(ctx.accounts.fanout.last_snapshot_amount)
    .unwrap();
  let tss = ctx.accounts.fanout.total_staked_shares;
  let shares_diff = ctx.accounts.fanout.total_shares.checked_sub(tss).unwrap();
  let unstaked_correction = (inflow as u128)
    .checked_mul(shares_diff as u128)
    .unwrap()
    .checked_div(tss as u128)
    .unwrap() as u64;

  let last_inflow = ctx.accounts.voucher.total_inflow;
  let total_shares = ctx.accounts.fanout.total_shares;
  let inflow_diff = inflow.checked_sub(last_inflow).unwrap();
  let dist_amount = u128::from(inflow_diff)
    .checked_mul(TWELVE_PREC) // Add 12 precision on dust
    .unwrap()
    .checked_mul(ctx.accounts.voucher.shares as u128)
    .unwrap()
    .checked_div(total_shares as u128)
    .unwrap();

  let mut dist_amount_u64: u64 = dist_amount
    .checked_div(TWELVE_PREC)
    .unwrap()
    .try_into()
    .unwrap();

  // Account for dust
  let dust: u64 = dist_amount
    .checked_sub(
      u128::from(dist_amount_u64)
        .checked_mul(TWELVE_PREC)
        .unwrap(),
    )
    .unwrap()
    .try_into()
    .unwrap();

  let new_dust = dust + ctx.accounts.voucher.total_dust;
  let whole_dust = dust
    .checked_div(u64::try_from(TWELVE_PREC).unwrap())
    .unwrap();
  if whole_dust > 1 {
    dist_amount_u64 += 1;
    ctx.accounts.voucher.total_dust = new_dust
      .checked_sub(u64::try_from(TWELVE_PREC).unwrap())
      .unwrap();
  } else {
    ctx.accounts.voucher.total_dust = new_dust;
  }

  let signer_seeds: &[&[u8]] = voucher_seeds!(ctx.accounts.voucher);
  token::transfer(
    ctx.accounts.transfer_ctx().with_signer(&[signer_seeds]),
    dist_amount_u64,
  )?;

  ctx.accounts.voucher.total_inflow = ctx.accounts.fanout.total_inflow;
  ctx.accounts.fanout.last_snapshot_amount = curr_balance;
  ctx.accounts.fanout.total_inflow = ctx
    .accounts
    .fanout
    .total_inflow
    .checked_add(inflow)
    .unwrap()
    .checked_add(unstaked_correction)
    .unwrap();

  Ok(())
}
