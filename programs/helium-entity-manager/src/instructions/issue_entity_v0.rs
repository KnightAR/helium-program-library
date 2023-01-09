use std::cmp::min;

use crate::state::*;
use crate::{constants::HOTSPOT_METADATA_URL, error::ErrorCode};
use anchor_lang::prelude::*;
use anchor_spl::token::Mint;
use angry_purple_tiger::AnimalName;
use mpl_bubblegum::state::metaplex_adapter::{Collection, MetadataArgs, TokenProgramVersion};
use mpl_bubblegum::state::{metaplex_adapter::TokenStandard, TreeConfig};
use mpl_bubblegum::{
  cpi::{accounts::MintToCollectionV1, mint_to_collection_v1},
  program::Bubblegum,
};
use spl_account_compression::{program::SplAccountCompression, Noop};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct IssueEntityArgsV0 {
  pub entity_key: String,
}

#[derive(Accounts)]
#[instruction(args: IssueEntityArgsV0)]
pub struct IssueEntityV0<'info> {
  #[account(mut)]
  pub payer: Signer<'info>,
  pub issuing_authority: Signer<'info>,
  pub collection: Box<Account<'info, Mint>>,
  /// CHECK: Handled by cpi
  #[account(
    mut,
    seeds = ["metadata".as_bytes(), token_metadata_program.key().as_ref(), collection.key().as_ref()],
    seeds::program = token_metadata_program.key(),
    bump,
  )]
  pub collection_metadata: UncheckedAccount<'info>,
  /// CHECK: Handled By cpi account
  #[account(
    seeds = ["metadata".as_bytes(), token_metadata_program.key().as_ref(), collection.key().as_ref(), "edition".as_bytes()],
    seeds::program = token_metadata_program.key(),
    bump,
  )]
  pub collection_master_edition: UncheckedAccount<'info>,
  #[account(
    mut,
    has_one = issuing_authority,
    has_one = collection,
    has_one = merkle_tree,
  )]
  pub maker: Box<Account<'info, MakerV0>>,
  #[account(
      mut,
      seeds = [merkle_tree.key().as_ref()],
      seeds::program = bubblegum_program.key(),
      bump,
  )]
  pub tree_authority: Box<Account<'info, TreeConfig>>,
  /// CHECK: Used in cpi
  pub recipient: AccountInfo<'info>,
  /// CHECK: Used in cpi
  #[account(mut)]
  pub merkle_tree: AccountInfo<'info>,
  #[account(
    seeds = ["collection_cpi".as_bytes()],
    seeds::program = bubblegum_program.key(),
    bump,
  )]
  /// CHECK: Used in cpi
  pub bubblegum_signer: UncheckedAccount<'info>,

  /// CHECK: Verified by constraint  
  #[account(address = mpl_token_metadata::ID)]
  pub token_metadata_program: AccountInfo<'info>,
  pub log_wrapper: Program<'info, Noop>,
  pub bubblegum_program: Program<'info, Bubblegum>,
  pub compression_program: Program<'info, SplAccountCompression>,
  pub system_program: Program<'info, System>,
}

impl<'info> IssueEntityV0<'info> {
  fn mint_to_collection_ctx(&self) -> CpiContext<'_, '_, '_, 'info, MintToCollectionV1<'info>> {
    let cpi_accounts = MintToCollectionV1 {
      tree_authority: self.tree_authority.to_account_info(),
      leaf_delegate: self.recipient.to_account_info(),
      leaf_owner: self.recipient.to_account_info(),
      merkle_tree: self.merkle_tree.to_account_info(),
      payer: self.payer.to_account_info(),
      tree_delegate: self.maker.to_account_info(),
      log_wrapper: self.log_wrapper.to_account_info(),
      compression_program: self.compression_program.to_account_info(),
      system_program: self.system_program.to_account_info(),
      collection_authority: self.maker.to_account_info(),
      collection_authority_record_pda: self.bubblegum_program.to_account_info(),
      collection_mint: self.collection.to_account_info(),
      collection_metadata: self.collection_metadata.to_account_info(),
      edition_account: self.collection_master_edition.to_account_info(),
      bubblegum_signer: self.bubblegum_signer.to_account_info(),
      token_metadata_program: self.token_metadata_program.to_account_info(),
    };
    CpiContext::new(self.bubblegum_program.to_account_info(), cpi_accounts)
  }
}

pub fn handler(ctx: Context<IssueEntityV0>, args: IssueEntityArgsV0) -> Result<()> {
  let animal_name: AnimalName = args
    .entity_key
    .parse()
    .map_err(|_| error!(ErrorCode::InvalidEccCompact))?;

  let maker_seeds: &[&[&[u8]]] = &[&[
    b"maker",
    ctx.accounts.maker.name.as_bytes(),
    &[ctx.accounts.maker.bump_seed],
  ]];

  let name = animal_name.to_string();
  let metadata = MetadataArgs {
    name: name[..min(name.len(), 32)].to_owned(),
    symbol: String::from("HOTSPOT"),
    uri: format!("{}/{}", HOTSPOT_METADATA_URL, args.entity_key),
    collection: Some(Collection {
      key: ctx.accounts.collection.key(),
      verified: false, // Verified in cpi
    }),
    primary_sale_happened: true,
    is_mutable: true,
    edition_nonce: None,
    token_standard: Some(TokenStandard::NonFungible),
    uses: None,
    token_program_version: TokenProgramVersion::Original,
    creators: vec![],
    seller_fee_basis_points: 0,
  };

  mint_to_collection_v1(
    ctx
      .accounts
      .mint_to_collection_ctx()
      .with_signer(maker_seeds),
    metadata,
  )?;

  Ok(())
}