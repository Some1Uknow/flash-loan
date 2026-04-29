use anchor_lang::prelude::*;

use anchor_spl::{
    associated_token::AssociatedToken,
    token::{transfer, Mint, Token, TokenAccount, Transfer},
};
use solana_instructions_sysvar::{
    load_current_index_checked, load_instruction_at_checked, ID as INSTRUCTIONS_SYSVAR_ID,
};

pub mod error;
pub use error::*;

pub mod borrow;
pub mod repay;

pub use borrow::*;
pub use repay::*;

declare_id!("22222222222222222222222222222222222222222222");

#[program]
pub mod flash_loan {
    use super::*;

    pub fn borrow(ctx: Context<Loan>, borrow_amount: u64) -> Result<()> {
        borrow::handler(ctx, borrow_amount)
    }

    pub fn repay(ctx: Context<Loan>) -> Result<()> {
        repay::handler(ctx)
    }
}

#[derive(Accounts)]
pub struct Loan<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,

    #[account(
    seeds = [b"protocol".as_ref()],
    bump,
    )]
    pub protocol: SystemAccount<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
    init_if_needed,
    payer = borrower,
    associated_token::mint = mint,
    associated_token::authority = borrower,
    )]
    pub borrower_ata: Account<'info, TokenAccount>,

    #[account(
    mut,
    associated_token::mint = mint,
    associated_token::authority = protocol,
    )]
    pub protocol_ata: Account<'info, TokenAccount>,

    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    /// CHECK: InstructionsSysvar account
    instructions: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
