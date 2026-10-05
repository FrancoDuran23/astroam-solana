// The transactions the backend sends, pinned in a fixture that the program
// tests execute (programs/astroam-escrow/tests/escrow.rs,
// `backend_transactions_run_against_the_program`). If a builder changes, this
// test fails until the fixture is regenerated, and then the Rust test says
// whether the program still accepts the new bytes:
//
//   UPDATE_FIXTURES=1 npm test && npm run solana:test

import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Keypair, type TransactionInstruction } from "@solana/web3.js";
import { SolanaEscrowChain } from "./EscrowChain.ts";
import { SOLANA_USDC_MINT } from "../shared/solana/constants.ts";
import { decodeBase58, encodeBase58 } from "../shared/solana/base58.ts";
import { closeVoucherMessage } from "../shared/solana/voucher.ts";
import type { SignedVoucher } from "../shared/solana/escrow.ts";

const FIXTURE = fileURLToPath(new URL("../../programs/astroam-escrow/tests/fixtures/backend-transactions.json", import.meta.url));

// Every key comes from a one-byte seed, so the Rust test rebuilds the same ones.
const SEEDS = { program: 1, payee: 3, traveler: 4, session: 5, operator: 7 };
const keypair = (seed: number) => Keypair.fromSeed(new Uint8Array(32).fill(seed));
const ESCROW_ID = encodeBase58(new Uint8Array(32).fill(0x22));
const PROGRAM = keypair(SEEDS.program).publicKey.toBase58();

function sessionVoucher(atomic: bigint): SignedVoucher {
  // PKCS#8 wrapper of an ed25519 seed.
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, SEEDS.session)]);
  const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const message = closeVoucherMessage(decodeBase58(PROGRAM), decodeBase58(ESCROW_ID), atomic);
  return {
    cumulativeAtomic: atomic.toString(),
    signature: sign(null, message, key).toString("base64"),
    signer: keypair(SEEDS.session).publicKey.toBase58(),
  };
}

function plain(instructions: TransactionInstruction[]) {
  return instructions.map((ix) => ({
    programId: ix.programId.toBase58(),
    keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
    data: Buffer.from(ix.data).toString("hex"),
  }));
}

function build() {
  const chain = new SolanaEscrowChain({
    rpcUrl: "http://127.0.0.1:1", // never contacted: only the builders run
    programId: PROGRAM,
    payee: keypair(SEEDS.payee).publicKey.toBase58(),
    usdcMint: SOLANA_USDC_MINT,
    operator: keypair(SEEDS.operator),
  });
  const traveler = keypair(SEEDS.traveler).publicKey.toBase58();
  return {
    seeds: SEEDS,
    programId: PROGRAM,
    escrowId: ESCROW_ID,
    mint: SOLANA_USDC_MINT,
    depositAtomic: "10000000",
    claim: {
      cumulativeAtomic: "3000000",
      instructions: plain(chain.claimInstructions({ escrowId: ESCROW_ID, voucher: sessionVoucher(3_000_000n) })),
    },
    close: {
      cumulativeAtomic: "3500000",
      instructions: plain(chain.closeInstructions({ escrowId: ESCROW_ID, voucher: sessionVoucher(3_500_000n), traveler })),
    },
  };
}

test("the backend's claim and close match the fixture the program tests execute", () => {
  const built = build();
  if (process.env.UPDATE_FIXTURES === "1" || !existsSync(FIXTURE)) {
    writeFileSync(FIXTURE, `${JSON.stringify(built, null, 2)}\n`);
  }
  assert.deepEqual(built, JSON.parse(readFileSync(FIXTURE, "utf8")));
});

test("the voucher check sits right before the program instruction, where the program reads it", () => {
  const { claim, close } = build();
  for (const tx of [claim, close]) {
    const last = tx.instructions.length - 1;
    assert.equal(tx.instructions[last]!.programId, PROGRAM);
    assert.equal(tx.instructions[last - 1]!.programId, "Ed25519SigVerify111111111111111111111111111");
  }
});
