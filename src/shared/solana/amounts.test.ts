import { test } from "node:test";
import assert from "node:assert/strict";
import { usageAtomic, usdcToSolanaAtomic, usdcToStellarRaw } from "./amounts.ts";
import { encodeBase58, decodeBase58 } from "./base58.ts";
import { SOLANA_USDC_DECIMALS, SOLANA_USDC_MINT, VOUCHER_PREFIX } from "./constants.ts";
import { solanaTxUrl } from "./explorer.ts";
import { buildClosePlan, closeVoucherMessage, escrowIdForMission } from "./voucher.ts";

test("Circle USDC on Solana devnet is 6 decimals, a tenth of the Stellar raw unit", () => {
  assert.equal(SOLANA_USDC_DECIMALS, 6);
  assert.equal(SOLANA_USDC_MINT, "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
  assert.equal(usdcToSolanaAtomic(5), 5_000_000n);
  assert.equal(usdcToStellarRaw(5), 50_000_000n);
  assert.equal(usdcToStellarRaw(5) / usdcToSolanaAtomic(5), 10n);
});

test("Brasil usage is priced in 6-decimal atomic units and capped by the deposit", () => {
  const deposit = usdcToSolanaAtomic(5);
  const used = usageAtomic({
    meteredBytes: 1_000_000_000n,
    pricePerMbUsdc: 0.0025,
    depositAtomic: deposit,
  });
  assert.equal(used, 2_500_000n);

  const naiveSevenDecimalCharge = (1_000_000_000n * 25_000n) / 1_000_000n;
  assert.equal(naiveSevenDecimalCharge, 25_000_000n);
  assert.ok(naiveSevenDecimalCharge > deposit);

  const capped = usageAtomic({
    meteredBytes: 3_000_000_000n,
    pricePerMbUsdc: 0.0025,
    depositAtomic: deposit,
  });
  assert.equal(capped, deposit);
});

test("close plan quotes one cumulative voucher, not a per-MB debit", () => {
  const plan = buildClosePlan({
    missionId: "mis_demo",
    budgetUsdc: 5,
    meteredBytes: 400_000_000n,
    pricePerMbUsdc: 0.0025,
    env: {},
  });
  assert.equal(plan.cumulativeAmount, "1000000");
  assert.equal(plan.refundAtomic, "4000000");
  assert.equal(plan.amount, "5000000");
  assert.equal(plan.deployed, false);
  assert.equal(plan.messageBase64, null);
  assert.equal(plan.cluster, "devnet");
  assert.equal(plan.usdcMint, SOLANA_USDC_MINT);
  assert.equal(escrowIdForMission("mis_demo").length, 32);
  assert.notDeepEqual(escrowIdForMission("mis_demo"), escrowIdForMission("mis_other"));
});

test("voucher bytes match the program fixture", () => {
  assert.equal(new TextEncoder().encode(VOUCHER_PREFIX).length, 22);
  const message = closeVoucherMessage(new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x22), 500_000n);
  assert.equal(Buffer.from(message.subarray(0, 22)).toString("utf8"), "AstroAmEscrow:v1:close");
  assert.ok(message.subarray(22, 54).every((b) => b === 0x11));
  assert.ok(message.subarray(54, 86).every((b) => b === 0x22));
  assert.equal(message[86], 0x20);
  assert.equal(message[87], 0xa1);
  assert.equal(message[88], 0x07);
  assert.equal(message.length, 94);
});

test("the message is bound to the configured program", () => {
  const programId = encodeBase58(new Uint8Array(32).fill(0x11));
  const payee = encodeBase58(new Uint8Array(32).fill(0x33));
  const plan = buildClosePlan({
    missionId: "mis_demo",
    budgetUsdc: 5,
    meteredBytes: 0n,
    pricePerMbUsdc: 0.0025,
    env: { SOLANA_PROGRAM_ID: programId, SOLANA_PAYEE_ADDRESS: payee },
  });
  assert.equal(plan.deployed, true);
  assert.equal(plan.programId, programId);
  assert.ok(plan.messageBase64);
  const message = Buffer.from(plan.messageBase64!, "base64");
  assert.equal(message.length, 94);
  assert.deepEqual(Buffer.from(decodeBase58(programId)), message.subarray(22, 54));
});

test("explorer links only real Solana signatures", () => {
  const signature = encodeBase58(new Uint8Array(64).fill(0xab));
  assert.equal(solanaTxUrl(signature), `https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  assert.equal(solanaTxUrl("demo_tx_hash"), null);
  assert.equal(solanaTxUrl("0x" + "ab".repeat(32)), null);
});

test("base58 round-trips the 32-zero system program address", () => {
  assert.equal(encodeBase58(new Uint8Array(32)), "11111111111111111111111111111111");
  assert.equal(decodeBase58("11111111111111111111111111111111").length, 32);
});
