// Signs cumulative escrow vouchers with AstroAm's meter key.
//
// The program accepts only the pubkey stored in its config. The traveler's
// wallet and the session key registered at deposit do not authorize a charge.

import { createPrivateKey, sign } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { decodeBase58 } from "../shared/solana/base58.ts";
import type { SignedVoucher } from "../shared/solana/escrow.ts";
import { closeVoucherMessage } from "../shared/solana/voucher.ts";
import { loadKeypair } from "./EscrowChain.ts";

export type MeterSigner = {
  readonly publicKey: string;
  sign(programId: string, escrowId: string, cumulativeAtomic: bigint): SignedVoucher;
};

/** A meter signer from a Solana keypair. The first 32 secret bytes are the ed25519 seed. */
export function meterSignerFromKeypair(keypair: Keypair): MeterSigner {
  const der = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.from(keypair.secretKey.subarray(0, 32)),
  ]);
  const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const publicKey = keypair.publicKey.toBase58();
  return {
    publicKey,
    sign(programId, escrowId, cumulativeAtomic) {
      const message = closeVoucherMessage(decodeBase58(programId), decodeBase58(escrowId), cumulativeAtomic);
      return {
        cumulativeAtomic: cumulativeAtomic.toString(),
        signature: sign(null, message, key).toString("base64"),
        signer: publicKey,
      };
    },
  };
}

/**
 * The meter key the backend signs with, or undefined when `SOLANA_METER_KEYPAIR`
 * is unset. Throws when the path is set but the file cannot be read.
 */
export function loadMeterSigner(env: Record<string, string | undefined>): MeterSigner | undefined {
  const path = env.SOLANA_METER_KEYPAIR?.trim();
  if (!path) return undefined;
  return meterSignerFromKeypair(loadKeypair(path));
}
