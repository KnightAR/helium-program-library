use anchor_lang::prelude::*;

declare_id!("hemABtqNUst4MmqsVcuN217ZzBspENbGt9uueSe5jts");

pub mod error;
pub mod instructions;
pub mod state;
pub mod token_metadata;

pub use instructions::*;
pub use state::*;

#[program]
pub mod helium_entity_manager {
  use super::*;

  pub fn initialize_hotspot_config_v0(
    ctx: Context<InitializeHotspotConfigV0>,
    args: InitializeHotspotConfigArgsV0,
  ) -> Result<()> {
    initialize_hotspot_config_v0::handler(ctx, args)
  }

  pub fn initialize_hotspot_issuer_v0(
    ctx: Context<InitializeHotspotIssuerV0>,
    args: InitializeHotspotIssuerArgsV0,
  ) -> Result<()> {
    initialize_hotspot_issuer_v0::handler(ctx, args)
  }

  pub fn issue_hotspot_v0(ctx: Context<IssueHotspotV0>, args: IssueHotspotArgsV0) -> Result<()> {
    issue_hotspot_v0::handler(ctx, args)
  }

  pub fn change_metadata_v0(
    ctx: Context<ChangeMetadataV0>,
    args: ChangeMetadataArgsV0,
  ) -> Result<()> {
    change_metadata_v0::handler(ctx, args)
  }

  pub fn assert_elevation_v0(
    ctx: Context<AssertElevationV0>,
    args: AssertElevationArgsV0,
  ) -> Result<()> {
    assert_elevation_v0::handler(ctx, args)
  }

  pub fn assert_gain_v0(ctx: Context<AssertGainV0>, args: AssertGainArgsV0) -> Result<()> {
    assert_gain_v0::handler(ctx, args)
  }

  pub fn assert_location_v0(
    ctx: Context<AssertLocationV0>,
    args: AssertLocationArgsV0,
  ) -> Result<()> {
    assert_location_v0::handler(ctx, args)
  }
}
