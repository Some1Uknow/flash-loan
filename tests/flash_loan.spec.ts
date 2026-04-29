import { expect } from "chai";
import { readFileSync } from "fs";
import path from "path";
import { BN, Program, Wallet } from "@coral-xyz/anchor";
import { LiteSVMProvider, fromWorkspace } from "anchor-litesvm";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SendTransactionError,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

const IDL = JSON.parse(
  readFileSync(path.join(process.cwd(), "target/idl/flash_loan.json"), "utf8"),
);

type FlashLoanProgram = Program<any>;

type Fixture = {
  client: ReturnType<typeof fromWorkspace>;
  provider: LiteSVMProvider;
  program: FlashLoanProgram;
  payer: Keypair;
  borrower: Keypair;
  protocol: PublicKey;
  mint: Keypair;
  borrowerAta: PublicKey;
  protocolAta: PublicKey;
};

const FLASH_LOAN_FEE_BPS = 500n;
const BPS_DENOMINATOR = 10_000n;

function feeFor(amount: bigint): bigint {
  return (amount * FLASH_LOAN_FEE_BPS) / BPS_DENOMINATOR;
}

function decodeTokenAmount(client: Fixture["client"], address: PublicKey): bigint {
  const account = client.getAccount(address);
  if (!account) {
    throw new Error(`missing token account ${address.toBase58()}`);
  }
  const amountBytes = account.data.slice(64, 72);
  return amountBytes.reduceRight(
    (acc, byte) => (acc << 8n) | BigInt(byte),
    0n,
  );
}

async function setupFixture(): Promise<Fixture> {
  const client = fromWorkspace(process.cwd());
  const provider = new LiteSVMProvider(client);
  const program = new Program(IDL, provider);
  const payer = (provider.wallet as Wallet).payer;
  const borrower = Keypair.generate();
  const mint = Keypair.generate();

  client.airdrop(borrower.publicKey, BigInt(LAMPORTS_PER_SOL));

  const [protocol] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol")],
    program.programId,
  );

  const borrowerAta = getAssociatedTokenAddressSync(
    mint.publicKey,
    borrower.publicKey,
  );
  const protocolAta = getAssociatedTokenAddressSync(mint.publicKey, protocol, true);

  const mintRent =
    await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);

  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports: mintRent,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(
      mint.publicKey,
      0,
      payer.publicKey,
      payer.publicKey,
    ),
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      protocolAta,
      protocol,
      mint.publicKey,
    ),
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      borrowerAta,
      borrower.publicKey,
      mint.publicKey,
    ),
  );
  await provider.sendAndConfirm(createMintTx, [mint]);

  const seedLiquidityTx = new Transaction().add(
    createMintToInstruction(mint.publicKey, protocolAta, payer.publicKey, 1_000),
    createMintToInstruction(mint.publicKey, borrowerAta, payer.publicKey, 100),
  );
  await provider.sendAndConfirm(seedLiquidityTx);

  return {
    client,
    provider,
    program,
    payer,
    borrower,
    protocol,
    mint,
    borrowerAta,
    protocolAta,
  };
}

function buildAccounts(fixture: Fixture, overrides?: Partial<Record<string, PublicKey>>) {
  return {
    borrower: overrides?.borrower ?? fixture.borrower.publicKey,
    protocol: overrides?.protocol ?? fixture.protocol,
    mint: overrides?.mint ?? fixture.mint.publicKey,
    borrowerAta: overrides?.borrowerAta ?? fixture.borrowerAta,
    protocolAta: overrides?.protocolAta ?? fixture.protocolAta,
    instructions:
      overrides?.instructions ??
      new PublicKey("Sysvar1nstructions1111111111111111111111111"),
    tokenProgram: overrides?.tokenProgram ?? TOKEN_PROGRAM_ID,
    associatedTokenProgram:
      overrides?.associatedTokenProgram ??
      new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
    systemProgram: overrides?.systemProgram ?? SystemProgram.programId,
  };
}

async function expectAnchorFailure(
  promise: Promise<unknown>,
  expectedFragment: string,
) {
  try {
    await promise;
    throw new Error(`expected failure containing: ${expectedFragment}`);
  } catch (error) {
    const message =
      error instanceof SendTransactionError
        ? `${error.message}\n${(error.logs ?? []).join("\n")}`
        : String(error);
    expect(message).to.include(expectedFragment);
  }
}

describe("flash_loan with anchor-litesvm", () => {
  it("executes borrow + repay atomically and leaves the fee in the protocol vault", async () => {
    const fixture = await setupFixture();
    const borrowAmount = 80n;
    const fee = feeFor(borrowAmount);

    const protocolBefore = decodeTokenAmount(fixture.client, fixture.protocolAta);
    const borrowerBefore = decodeTokenAmount(fixture.client, fixture.borrowerAta);

    const borrowIx = await fixture.program.methods
      .borrow(new BN(borrowAmount.toString()))
      .accounts(buildAccounts(fixture))
      .instruction();

    const repayIx = await fixture.program.methods
      .repay()
      .accounts(buildAccounts(fixture))
      .instruction();

    const tx = new Transaction().add(borrowIx, repayIx);
    await fixture.provider.sendAndConfirm(tx, [fixture.borrower]);

    const protocolAfter = decodeTokenAmount(fixture.client, fixture.protocolAta);
    const borrowerAfter = decodeTokenAmount(fixture.client, fixture.borrowerAta);

    expect(protocolAfter).to.equal(protocolBefore + fee);
    expect(borrowerAfter).to.equal(borrowerBefore - fee);
  });

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

  it("rejects a borrow transaction whose final instruction is not repay", async () => {
    const fixture = await setupFixture();

    await expectAnchorFailure(
      fixture.program.methods
        .borrow(new BN(50))
        .accounts(buildAccounts(fixture))
        .signers([fixture.borrower])
        .rpc(),
      "InvalidIx",
    );
  });

  it("rejects a repay leg that points at the wrong protocol ATA", async () => {
    const fixture = await setupFixture();
    const wrongProtocolAta = getAssociatedTokenAddressSync(
      fixture.mint.publicKey,
      fixture.borrower.publicKey,
      false,
    );

    const borrowIx = await fixture.program.methods
      .borrow(new BN(50))
      .accounts(buildAccounts(fixture))
      .instruction();

    const repayIx = await fixture.program.methods
      .repay()
      .accounts(buildAccounts(fixture, { protocolAta: wrongProtocolAta }))
      .instruction();

    const tx = new Transaction().add(borrowIx, repayIx);
    await expectAnchorFailure(
      fixture.provider.sendAndConfirm(tx, [fixture.borrower]),
      "InvalidProtocolAta",
    );
  });

  it("fails standalone repay because the transaction does not carry a valid borrow prelude", async () => {
    const fixture = await setupFixture();

    await expectAnchorFailure(
      fixture.program.methods
        .repay()
        .accounts(buildAccounts(fixture))
        .signers([fixture.borrower])
        .rpc(),
      "failed",
    );
  });
});
