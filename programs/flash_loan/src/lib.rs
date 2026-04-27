pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("9ewZK3M7tG8kgcWhHiy33iTbcYpzkiof8L8XZzhSb6np");

#[program]
pub mod blueshift_anchor_flash_loan {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }
}
