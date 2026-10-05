import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { encodeBase58 } from "./base58.ts";
import { ESCROW_LEN, claimData, closeData, decodeEscrow, depositData, verifyVoucher } from "./escrow.ts";
import { closeVoucherMessage } from "./voucher.ts";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const key = (byte: number) => encodeBase58(new Uint8Array(32).fill(byte));

// The same bytes as `instruction_data_matches_the_shared_fixture` in
// programs/astroam-escrow/tests/escrow.rs. Change both or neither.
const DEPOSIT_HEX = `01${"22".repeat(32)}404b4c0000000000`;
const DEPOSIT_WITH_SESSION_HEX = `${DEPOSIT_HEX}${"55".repeat(32)}`;
const CLAIM_HEX = "0520a1070000000000";
const CLOSE_HEX = "0320a1070000000000";

test("instruction data matches the fixture shared with the program tests", () => {
  assert.equal(hex(depositData(key(0x22), 5_000_000n)), DEPOSIT_HEX);
  assert.equal(hex(depositData(key(0x22), 5_000_000n, key(0x55))), DEPOSIT_WITH_SESSION_HEX);
  assert.equal(hex(claimData(500_000n)), CLAIM_HEX);
  assert.equal(hex(closeData(500_000n)), CLOSE_HEX);
});

test("an escrow account decodes to the traveler, deposit, session key and claimed amount", () => {
  const raw = new Uint8Array(ESCROW_LEN);
  const view = new DataView(raw.buffer);
  raw[0] = 1;
  raw.fill(0x44, 1, 33);
  view.setBigInt64(33, 1_790_000_000n, true);
  view.setBigUint64(41, 10_000_000n, true);
  raw[49] = 0;
  raw.fill(0x22, 51, 83);
  raw.fill(0x55, 83, 115);
  view.setBigUint64(115, 2_000_000n, true);

  assert.deepEqual(decodeEscrow(raw), {
    traveler: key(0x44),
    activeAt: 1_790_000_000,
    deposit: 10_000_000n,
    settled: false,
    escrowId: key(0x22),
    sessionKey: key(0x55),
    claimed: 2_000_000n,
  });

  raw.fill(0, 83, 115);
  assert.equal(decodeEscrow(raw)?.sessionKey, null);
  // The first layout was 83 bytes: no session key and nothing claimed.
  const legacy = decodeEscrow(raw.subarray(0, 83));
  assert.equal(legacy?.deposit, 10_000_000n);
  assert.equal(legacy?.sessionKey, null);
  assert.equal(legacy?.claimed, 0n);
  assert.equal(decodeEscrow(raw.subarray(0, 82)), null);
});

test("a voucher verifies only for its own signer, escrow, program and amount", () => {
  const session = generateKeyPairSync("ed25519");
  const signer = encodeBase58(new Uint8Array(session.publicKey.export({ type: "spki", format: "der" }).subarray(-32)));
  const program = key(0x11);
  const escrow = key(0x22);
  const message = closeVoucherMessage(new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x22), 625_000n);
  const voucher = { cumulativeAtomic: "625000", signature: sign(null, message, session.privateKey).toString("base64"), signer };

  assert.equal(verifyVoucher(program, escrow, voucher), true);
  assert.equal(verifyVoucher(program, escrow, { ...voucher, cumulativeAtomic: "625001" }), false);
  assert.equal(verifyVoucher(program, key(0x23), voucher), false);
  assert.equal(verifyVoucher(key(0x12), escrow, voucher), false);
  assert.equal(verifyVoucher(program, escrow, { ...voucher, signer: key(0x44) }), false);
  assert.equal(verifyVoucher(program, escrow, { ...voucher, signature: "not base64 of 64 bytes" }), false);
});
