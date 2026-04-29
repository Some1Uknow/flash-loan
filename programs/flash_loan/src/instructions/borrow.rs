use anchor_lang::prelude::*;
use anchor_lang::Discriminator;
use anchor_spl::token::{transfer, Transfer};

use crate::{instruction, Loan, ProtocolError, ID};

pub fn handler(ctx: Context<Loan>, borrow_amount: u64) -> Result<()> {
    // Make sure we're not sending in an invalid amount that can crash our Protocol
    require!(borrow_amount > 0, ProtocolError::InvalidAmount);

    // Derive the Signer Seeds for the Protocol Account
    let seeds = &[b"protocol".as_ref(), &[ctx.bumps.protocol]];
    let signer_seeds = &[&seeds[..]];

    // Transfer the funds from the protocol to the borrower
    transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.protocol_ata.to_account_info(),
                to: ctx.accounts.borrower_ata.to_account_info(),
                authority: ctx.accounts.protocol.to_account_info(),
            },
            signer_seeds,
        ),
        borrow_amount,
    )?;

    let ixs = ctx.accounts.instructions.to_account_info();

    /*
        Repay Instruction Check

        Make sure that the last instruction of this transaction is a repay instruction
    */

    // Check if this is the first instruction in the transaction.
    let current_index = load_current_index_checked(&ctx.accounts.instructions)?;
    require_eq!(current_index, 0, ProtocolError::InvalidIx);

    // Check how many instruction we have in this transaction
    let instruction_sysvar = ixs.try_borrow_data()?;
    let len = u16::from_le_bytes(instruction_sysvar[0..2].try_into().unwrap());

    // Ensure we have a repay ix
    if let Ok(repay_ix) = load_instruction_at_checked(len as usize - 1, &ixs) {
        // Instruction checks
        require_keys_eq!(repay_ix.program_id, ID, ProtocolError::InvalidProgram);
        require!(
            repay_ix.data[0..8].eq(instruction::Repay::DISCRIMINATOR),
            ProtocolError::InvalidIx
        );

        // We could check the Wallet and Mint separately but by checking the ATA we do this automatically
        require_keys_eq!(
            repay_ix
                .accounts
                .get(3)
                .ok_or(ProtocolError::InvalidBorrowerAta)?
                .pubkey,
            ctx.accounts.borrower_ata.key(),
            ProtocolError::InvalidBorrowerAta
        );
        require_keys_eq!(
            repay_ix
                .accounts
                .get(4)
                .ok_or(ProtocolError::InvalidProtocolAta)?
                .pubkey,
            ctx.accounts.protocol_ata.key(),
            ProtocolError::InvalidProtocolAta
        );
    } else {
        return Err(ProtocolError::MissingRepayIx.into());
    }
    Ok(())
}
