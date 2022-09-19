use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

pub use errors::*;
pub use instructions::*;
pub use state::*;

declare_id!("5BAQuzGE1z8CTcrSdfbfdBF2fdXrwb4iMcxDMrvhz8L8");

#[program]
pub mod data_credits {
  use super::*;

  pub fn initialize_data_credits_v0(
    ctx: Context<InitializeDataCreditsV0>,
    args: InitializeDataCreditsV0Args,
  ) -> Result<()> {
    instructions::initialize_data_credits_v0::handler(ctx, args)
  }

  pub fn mint_data_credits_v0(
    ctx: Context<MintDataCreditsV0>,
    args: MintDataCreditsV0Args,
  ) -> Result<()> {
    instructions::mint_data_credits_v0::handler(ctx, args)
  }

  pub fn burn_data_credits_v0(
    ctx: Context<BurnDataCreditsV0>,
    args: BurnDataCreditsV0Args,
  ) -> Result<()> {
    instructions::burn_data_credits_v0::handler(ctx, args)
  }
}
