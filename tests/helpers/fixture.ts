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

export type FlashLoanProgram = Program<any>;

export type Fixture = {
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

export type FixtureOptions = {
  protocolLiquidity?: number;
  borrowerLiquidity?: number;
};

export const INSTRUCTIONS_SYSVAR = new PublicKey(
  "Sysvar1nstructions1111111111111111111111111",
);
export const ASSOCIATED_TOKEN_PROGRAM = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
export const FLASH_LOAN_FEE_BPS = 500n;
export const BPS_DENOMINATOR = 10_000n;

export function feeFor(amount: bigint): bigint {
  return (amount * FLASH_LOAN_FEE_BPS) / BPS_DENOMINATOR;
}

export function decodeTokenAmount(
  client: Fixture["client"],
  address: PublicKey,
): bigint {
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

export async function setupFixture(
  options: FixtureOptions = {},
): Promise<Fixture> {
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

  const protocolLiquidity = options.protocolLiquidity ?? 1_000;
  const borrowerLiquidity = options.borrowerLiquidity ?? 100;
  const seedLiquidityTx = new Transaction().add(
    createMintToInstruction(
      mint.publicKey,
      protocolAta,
      payer.publicKey,
      protocolLiquidity,
    ),
    createMintToInstruction(
      mint.publicKey,
      borrowerAta,
      payer.publicKey,
      borrowerLiquidity,
    ),
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

export function buildAccounts(
  fixture: Fixture,
  overrides?: Partial<Record<string, PublicKey>>,
) {
  return {
    borrower: overrides?.borrower ?? fixture.borrower.publicKey,
    protocol: overrides?.protocol ?? fixture.protocol,
    mint: overrides?.mint ?? fixture.mint.publicKey,
    borrowerAta: overrides?.borrowerAta ?? fixture.borrowerAta,
    protocolAta: overrides?.protocolAta ?? fixture.protocolAta,
    instructions: overrides?.instructions ?? INSTRUCTIONS_SYSVAR,
    tokenProgram: overrides?.tokenProgram ?? TOKEN_PROGRAM_ID,
    associatedTokenProgram:
      overrides?.associatedTokenProgram ?? ASSOCIATED_TOKEN_PROGRAM,
    systemProgram: overrides?.systemProgram ?? SystemProgram.programId,
  };
}

export async function expectAnchorFailure(
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

export function captureBalances(fixture: Fixture) {
  return {
    protocol: decodeTokenAmount(fixture.client, fixture.protocolAta),
    borrower: decodeTokenAmount(fixture.client, fixture.borrowerAta),
  };
}

export async function buildBorrowIx(fixture: Fixture, amount: bigint) {
  return fixture.program.methods
    .borrow(new BN(amount.toString()))
    .accounts(buildAccounts(fixture))
    .instruction();
}

export async function buildRepayIx(
  fixture: Fixture,
  overrides?: Partial<Record<string, PublicKey>>,
) {
  return fixture.program.methods
    .repay()
    .accounts(buildAccounts(fixture, overrides))
    .instruction();
}
