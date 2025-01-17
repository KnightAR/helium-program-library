use crate::state::*;
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct UpdateRewardableEntityConfigArgsV0 {
  pub new_authority: Option<Pubkey>,
  pub settings: Option<ConfigSettingsV0>,
}

#[derive(Accounts)]
#[instruction(args: UpdateRewardableEntityConfigArgsV0)]
pub struct UpdateRewardableEntityConfigV0<'info> {
  pub authority: Signer<'info>,
  #[account(
    mut,
    has_one = authority,
  )]
  pub rewardable_entity_config: Box<Account<'info, RewardableEntityConfigV0>>,
}

pub fn handler(
  ctx: Context<UpdateRewardableEntityConfigV0>,
  args: UpdateRewardableEntityConfigArgsV0,
) -> Result<()> {
  let config = &mut ctx.accounts.rewardable_entity_config;
  if let Some(new_authority) = args.new_authority {
    config.authority = new_authority;
  }

  if let Some(settings) = args.settings {
    config.settings = settings;
  }

  Ok(())
}
