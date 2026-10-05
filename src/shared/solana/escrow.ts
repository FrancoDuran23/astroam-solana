// Byte layouts of the escrow program (programs/astroam-escrow/src/lib.rs) and
// the check of a cumulative voucher. No RPC and no wallet here: the backend,
// the tests and the fixture shared with the Rust tests all build on these.

import { createPublicKey, verify } from "node:crypto";
import { decodeBase58, encodeBase58 } from "./base58.ts";
import { closeVoucherMessage } from "./voucher.ts";

export const TAG_DEPOSIT = 1;
export const TAG_TOP_UP = 2;
export const TAG_CLOSE = 3;
export const TAG_REFUND = 4;
export const TAG_CLAIM = 5;

/** Same as `ESCROW_LEN` in the program. */
export const ESCROW_LEN = 123;
/** Escrows opened by the first deployed program: no session key, no claims. */
export const LEGACY_ESCROW_LEN = 83;

const NO_SESSION_KEY = encodeBase58(new Uint8Array(32));

function u64(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) throw new RangeError("escrow: amount out of u64 range");
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

function key32(value: string, what: string): Uint8Array {
  const bytes = decodeBase58(value);
  if (bytes.length !== 32) throw new RangeError(`escrow: ${what} is not a 32-byte base58 key`);
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** `deposit`: 41 bytes, or 73 when the traveler registers a session key. */
export function depositData(escrowId: string, amount: bigint, sessionKey?: string | null): Uint8Array {
  const head = concat(Uint8Array.of(TAG_DEPOSIT), key32(escrowId, "escrow id"), u64(amount));
  return sessionKey ? concat(head, key32(sessionKey, "session key")) : head;
}

/** `claim`: pays AstroAm the unpaid part of the voucher and keeps the escrow open. */
export function claimData(cumulative: bigint): Uint8Array {
  return concat(Uint8Array.of(TAG_CLAIM), u64(cumulative));
}

/** `close`: pays the rest of the voucher and refunds the remaining deposit. */
export function closeData(cumulative: bigint): Uint8Array {
  return concat(Uint8Array.of(TAG_CLOSE), u64(cumulative));
}

export type EscrowState = {
  traveler: string;
  /** Unix seconds of the deposit, last top-up or last claim. The refund timeout runs from here. */
  activeAt: number;
  deposit: bigint;
  settled: boolean;
  escrowId: string;
  /** Null when the deposit registered none. */
  sessionKey: string | null;
  /** Already paid to AstroAm by `claim`. */
  claimed: bigint;
};

/** Decodes an escrow account. Null when the bytes are not an escrow. */
export function decodeEscrow(data: Uint8Array): EscrowState | null {
  if (data.length < LEGACY_ESCROW_LEN || data[0] !== 1) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // A first-layout escrow reads as "no session key, nothing claimed", the way the program reads it.
  const extended = data.length >= ESCROW_LEN;
  const sessionKey = extended ? encodeBase58(data.subarray(83, 115)) : NO_SESSION_KEY;
  return {
    traveler: encodeBase58(data.subarray(1, 33)),
    activeAt: Number(view.getBigInt64(33, true)),
    deposit: view.getBigUint64(41, true),
    settled: data[49] === 1,
    escrowId: encodeBase58(data.subarray(51, 83)),
    sessionKey: sessionKey === NO_SESSION_KEY ? null : sessionKey,
    claimed: extended ? view.getBigUint64(115, true) : 0n,
  };
}

/** A cumulative voucher as the app sends it: who signed, how much, and the ed25519 signature. */
export type SignedVoucher = {
  /** Total USDC (6-decimal atomic units) the traveler authorizes AstroAm to collect. */
  cumulativeAtomic: string;
  /** base64 of the 64-byte ed25519 signature over the voucher message. */
  signature: string;
  /** base58 public key that signed: the traveler wallet or the session key. */
  signer: string;
};

// DER prefix of an ed25519 SubjectPublicKeyInfo; the 32 raw key bytes follow.
const ED25519_SPKI_PREFIX = Uint8Array.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);

/**
 * True when `voucher.signature` is `voucher.signer`'s signature over the
 * message the program checks for this program, escrow and amount. It does
 * not check that the signer is allowed to sign for the escrow.
 */
export function verifyVoucher(programId: string, escrowId: string, voucher: SignedVoucher): boolean {
  try {
    const amount = BigInt(voucher.cumulativeAtomic);
    const message = closeVoucherMessage(key32(programId, "program id"), key32(escrowId, "escrow id"), amount);
    const signature = Buffer.from(voucher.signature, "base64");
    if (signature.length !== 64) return false;
    const publicKey = createPublicKey({
      key: Buffer.from(concat(ED25519_SPKI_PREFIX, key32(voucher.signer, "signer"))),
      format: "der",
      type: "spki",
    });
    return verify(null, message, publicKey, signature);
  } catch {
    return false;
  }
}
