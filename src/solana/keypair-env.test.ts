import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair } from "@solana/web3.js";
import { createEscrowChain } from "./EscrowChain.ts";
import { loadMeterSigner } from "./meter-signer.ts";

test("a hosted JSON secret loads the operator and the meter without a keypair file", () => {
  const operator = Keypair.generate();
  const meter = Keypair.generate();
  const programId = Keypair.generate().publicKey.toBase58();
  const payee = Keypair.generate().publicKey.toBase58();
  const chain = createEscrowChain({
    SOLANA_OPERATOR_KEYPAIR_JSON: JSON.stringify(Array.from(operator.secretKey)),
    SOLANA_PROGRAM_ID: programId,
    SOLANA_PAYEE_ADDRESS: payee,
  });
  assert.equal(chain?.operator, operator.publicKey.toBase58());

  const signer = loadMeterSigner({
    SOLANA_METER_KEYPAIR_JSON: JSON.stringify(Array.from(meter.secretKey)),
  });
  assert.equal(signer?.publicKey, meter.publicKey.toBase58());
  const voucher = signer!.sign(programId, payee, 1_000_000n);
  assert.equal(voucher.signer, meter.publicKey.toBase58());
  assert.equal(voucher.cumulativeAtomic, "1000000");
  assert.ok(voucher.signature.length > 0);
});
