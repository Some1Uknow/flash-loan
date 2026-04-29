
  use anchor_lang::prelude::*;
  use anchor_lang::Discriminator;
  use anchor_spl::token::{transfer, Transfer};

  use crate::{instruction, Loan, ProtocolError, ID};

  pub fn handler(ctx: Context<Loan>, borrow_amount: u64) -> Result<()> {
      
  }

