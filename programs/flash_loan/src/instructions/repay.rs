use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Transfer};
use solana_instructions_sysvar::load_instruction_at_checked;

use crate::{Loan, ProtocolError};

pub fn handler(ctx: Context<Loan>) -> Result<()> {
    let ixs = ctx.accounts.instructions.to_account_info();

    let mut amount_borrowed: u64;

    if let Ok(borrow_ix) = load_instruction_at_checked(0, &ixs) {
        // Check the amount borrowed:
        let mut borrowed_data: [u8; 8] = [0u8; 8];
        borrowed_data.copy_from_slice(&borrow_ix.data[8..16]);
        amount_borrowed = u64::from_le_bytes(borrowed_data)
    } else {
        return Err(ProtocolError::MissingBorrowIx.into());
    }

    // Add the fee to the amount borrowed (In our case we hardcoded it to 500 basis point)
    let fee = (amount_borrowed as u128)
        .checked_mul(500)
        .unwrap()
        .checked_div(10_000)
        .ok_or(ProtocolError::Overflow)? as u64;
    amount_borrowed = amount_borrowed
        .checked_add(fee)
        .ok_or(ProtocolError::Overflow)?;

    // Transfer the funds from the protocol to the borrower
    transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.borrower_ata.to_account_info(),
                to: ctx.accounts.protocol_ata.to_account_info(),
                authority: ctx.accounts.borrower.to_account_info(),
            },
        ),
        amount_borrowed,
    )?;
    Ok(())
}
