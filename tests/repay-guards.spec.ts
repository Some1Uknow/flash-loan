import { expect } from "chai";
import { Transaction } from "@solana/web3.js";

import {
  buildAccounts,
  buildBorrowIx,
  buildRepayIx,
  captureBalances,
  expectAnchorFailure,
  setupFixture,
} from "./helpers/fixture";

describe("flash_loan repay guards", () => {
  it("fails standalone repay because the transaction does not carry a valid borrow prelude", async () => {
    const fixture = await setupFixture();
    const before = captureBalances(fixture);

    await expectAnchorFailure(
      fixture.program.methods
        .repay()
        .accounts(buildAccounts(fixture))
        .signers([fixture.borrower])
        .rpc(),
      "failed",
    );

    const after = captureBalances(fixture);
    expect(after).to.deep.equal(before);
  });

  it("fails when the borrower cannot cover principal plus fee", async () => {
    const fixture = await setupFixture({
      protocolLiquidity: 1_000,
      borrowerLiquidity: 0,
    });
    const before = captureBalances(fixture);

    const tx = new Transaction().add(
      await buildBorrowIx(fixture, 1_000n),
      await buildRepayIx(fixture),
    );

    await expectAnchorFailure(
      fixture.provider.sendAndConfirm(tx, [fixture.borrower]),
      "failed",
    );

    const after = captureBalances(fixture);
    expect(after).to.deep.equal(before);
  });

  it("uses the borrow instruction payload to derive repayment amount", async () => {
    const fixture = await setupFixture();
    const before = captureBalances(fixture);

    const tx = new Transaction().add(
      await buildBorrowIx(fixture, 25n),
      await buildRepayIx(fixture),
    );
    await fixture.provider.sendAndConfirm(tx, [fixture.borrower]);

    const after = captureBalances(fixture);
    expect(after.protocol - before.protocol).to.equal(1n);
    expect(before.borrower - after.borrower).to.equal(1n);
  });
});
