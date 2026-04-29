import { expect } from "chai";
import { Transaction } from "@solana/web3.js";

import {
  buildBorrowIx,
  buildRepayIx,
  captureBalances,
  feeFor,
  setupFixture,
} from "./helpers/fixture";

describe("flash_loan happy path", () => {
  it("executes borrow + repay atomically and leaves only the fee in the protocol vault", async () => {
    const fixture = await setupFixture();
    const borrowAmount = 80n;
    const fee = feeFor(borrowAmount);

    const before = captureBalances(fixture);

    const tx = new Transaction().add(
      await buildBorrowIx(fixture, borrowAmount),
      await buildRepayIx(fixture),
    );
    await fixture.provider.sendAndConfirm(tx, [fixture.borrower]);

    const after = captureBalances(fixture);

    expect(after.protocol).to.equal(before.protocol + fee);
    expect(after.borrower).to.equal(before.borrower - fee);
  });

  it("computes the fee deterministically across multiple borrow sizes", async () => {
    const cases = [1n, 20n, 80n, 200n];

    for (const borrowAmount of cases) {
      const fixture = await setupFixture();
      const before = captureBalances(fixture);
      const fee = feeFor(borrowAmount);

      const tx = new Transaction().add(
        await buildBorrowIx(fixture, borrowAmount),
        await buildRepayIx(fixture),
      );
      await fixture.provider.sendAndConfirm(tx, [fixture.borrower]);

      const after = captureBalances(fixture);
      expect(after.protocol).to.equal(
        before.protocol + fee,
        `protocol vault delta for borrow=${borrowAmount.toString()}`,
      );
      expect(after.borrower).to.equal(
        before.borrower - fee,
        `borrower delta for borrow=${borrowAmount.toString()}`,
      );
    }
  });
});
