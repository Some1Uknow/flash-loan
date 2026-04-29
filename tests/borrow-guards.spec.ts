import { BN } from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
  buildAccounts,
  buildBorrowIx,
  buildRepayIx,
  captureBalances,
  expectAnchorFailure,
  setupFixture,
} from "./helpers/fixture";

describe("flash_loan borrow guards", () => {
  it("rejects zero-amount borrows", async () => {
    const fixture = await setupFixture();

    await expectAnchorFailure(
      fixture.program.methods
        .borrow(new BN(0))
        .accounts(buildAccounts(fixture))
        .signers([fixture.borrower])
        .rpc(),
      "InvalidAmount",
    );
  });

  it("rejects a borrow transaction whose final instruction is still borrow", async () => {
    const fixture = await setupFixture();
    const before = captureBalances(fixture);

    await expectAnchorFailure(
      fixture.program.methods
        .borrow(new BN(50))
        .accounts(buildAccounts(fixture))
        .signers([fixture.borrower])
        .rpc(),
      "InvalidIx",
    );

    const after = captureBalances(fixture);
    expect(after).to.deep.equal(before);
  });

  it("rejects a transaction whose final instruction belongs to another program", async () => {
    const fixture = await setupFixture();
    const before = captureBalances(fixture);
    const receiver = Keypair.generate();

    const tx = new Transaction().add(
      await buildBorrowIx(fixture, 50n),
      SystemProgram.transfer({
        fromPubkey: fixture.borrower.publicKey,
        toPubkey: receiver.publicKey,
        lamports: 1,
      }),
    );

    await expectAnchorFailure(
      fixture.provider.sendAndConfirm(tx, [fixture.borrower]),
      "InvalidProgram",
    );

    const after = captureBalances(fixture);
    expect(after).to.deep.equal(before);
  });

  it("rejects a repay leg that points at the wrong protocol ATA", async () => {
    const fixture = await setupFixture();
    const before = captureBalances(fixture);
    const wrongProtocolAta = getAssociatedTokenAddressSync(
      fixture.mint.publicKey,
      fixture.borrower.publicKey,
      false,
    );

    const tx = new Transaction().add(
      await buildBorrowIx(fixture, 50n),
      await buildRepayIx(fixture, { protocolAta: wrongProtocolAta }),
    );

    await expectAnchorFailure(
      fixture.provider.sendAndConfirm(tx, [fixture.borrower]),
      "InvalidProtocolAta",
    );

    const after = captureBalances(fixture);
    expect(after).to.deep.equal(before);
  });

  it("rejects a repay leg that points at the wrong borrower ATA", async () => {
    const fixture = await setupFixture();
    const before = captureBalances(fixture);
    const outsider = Keypair.generate();
    const outsiderAta = getAssociatedTokenAddressSync(
      fixture.mint.publicKey,
      outsider.publicKey,
      false,
    );

    const tx = new Transaction().add(
      await buildBorrowIx(fixture, 50n),
      await buildRepayIx(fixture, { borrowerAta: outsiderAta }),
    );

    await expectAnchorFailure(
      fixture.provider.sendAndConfirm(tx, [fixture.borrower]),
      "InvalidBorrowerAta",
    );

    const after = captureBalances(fixture);
    expect(after).to.deep.equal(before);
  });

  it("fails if the token program account is incorrect", async () => {
    const fixture = await setupFixture();

    await expectAnchorFailure(
      fixture.program.methods
        .borrow(new BN(50))
        .accounts(
          buildAccounts(fixture, { tokenProgram: SystemProgram.programId }),
        )
        .signers([fixture.borrower])
        .rpc(),
      TOKEN_PROGRAM_ID.toBase58(),
    );
  });
});
