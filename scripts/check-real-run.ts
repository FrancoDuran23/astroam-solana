// Preflight for a run with a real eSIM (docs/real-esim.md). It answers "what
// is still missing?" before any money is spent. Read-only: it creates no
// eSIM, funds nothing and sends no transaction. The Citrus call is
// `GET /wallet/balance`; the Solana calls are account reads.
import "dotenv/config";
import { Connection, PublicKey, type Keypair } from "@solana/web3.js";
import { keypairFromJsonEnv, loadKeypair } from "../src/solana/EscrowChain.ts";
import { loadMeterSigner } from "../src/solana/meter-signer.ts";
import { SOLANA_RPC_URL } from "../src/shared/solana/constants.ts";

const env = process.env;
const CITRUS_BASE = env.CITRUS_BASE_URL?.trim() || "https://citrusmobile.com/api/v2/reseller";
// $1.75 to issue the eSIM plus one $2.50 tranche.
const MIN_CITRUS_USD = 4.25;
// A claim and a close cost 10,000 lamports each; creating a token account costs about 0.002 SOL.
const MIN_OPERATOR_LAMPORTS = 10_000_000;

let failures = 0;
const ok = (what: string) => console.log(`  ok    ${what}`);
const note = (what: string) => console.log(`  note  ${what}`);
const fail = (what: string, fix: string) => {
  failures += 1;
  console.log(`  FAIL  ${what}\n        fix: ${fix}`);
};

console.log("Real eSIM run: preflight\n");

console.log("eSIM provider");
if (env.CONNECTIVITY_PROVIDER !== "citrus") {
  fail(`CONNECTIVITY_PROVIDER is "${env.CONNECTIVITY_PROVIDER ?? ""}"`, "set CONNECTIVITY_PROVIDER=citrus");
}
const citrusKey = env.CITRUS_API_KEY?.trim();
if (!citrusKey) {
  fail("CITRUS_API_KEY is empty", "paste the reseller key (rsk_…) from the Citrus dashboard");
} else {
  try {
    const res = await fetch(`${CITRUS_BASE}/wallet/balance`, {
      headers: { Authorization: `Bearer ${citrusKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) {
      fail("Citrus rejected the key (401)", "generate a new key in the Citrus dashboard");
    } else if (!res.ok) {
      fail(`Citrus answered ${res.status} to GET /wallet/balance`, "try again; if it repeats, check CITRUS_BASE_URL");
    } else {
      const balance = Number(((await res.json()) as { balance_usd?: number }).balance_usd);
      if (!Number.isFinite(balance)) {
        fail("Citrus did not return a balance", "check the account in the dashboard");
      } else if (balance < MIN_CITRUS_USD) {
        fail(`reseller balance is $${balance.toFixed(2)}`, `top up in the dashboard: the run needs at least $${MIN_CITRUS_USD.toFixed(2)}`);
      } else {
        ok(`Citrus key works; reseller balance $${balance.toFixed(2)}`);
      }
    }
  } catch (error) {
    fail(`could not reach Citrus (${error instanceof Error ? error.message : String(error)})`, "check the connection and CITRUS_BASE_URL");
  }
}
if (env.ENABLE_DEMO_TRAFFIC === "true") {
  fail("ENABLE_DEMO_TRAFFIC is true, so usage can still be invented", "set ENABLE_DEMO_TRAFFIC=false");
} else {
  ok("demo traffic is off: usage is what the carrier reports");
}

console.log("\nEscrow program");
const connection = new Connection(env.SOLANA_RPC_URL?.trim() || SOLANA_RPC_URL, "confirmed");
let configMeter: string | undefined;
let configPayee: string | undefined;
let programId: PublicKey | undefined;
try {
  programId = new PublicKey(env.SOLANA_PROGRAM_ID?.trim() ?? "");
} catch {
  fail("SOLANA_PROGRAM_ID is not a Solana address", "copy it from .env.example or from your own deploy");
}
if (programId) {
  try {
    const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
    const account = await connection.getAccountInfo(config);
    if (!account || !account.owner.equals(programId)) {
      fail("the program has no config account on this cluster", "run npm run solana:deploy, or fix SOLANA_PROGRAM_ID / SOLANA_RPC_URL");
    } else if (account.data.length < 106 || account.data[0] !== 2) {
      fail("this program stores no meter key (it is the first deployment)", "use the program in .env.example, or deploy the current code");
    } else {
      configPayee = new PublicKey(account.data.subarray(1, 33)).toBase58();
      configMeter = new PublicKey(account.data.subarray(74, 106)).toBase58();
      ok(`program ${programId.toBase58()} is initialized`);
      const envPayee = env.SOLANA_PAYEE_ADDRESS?.trim();
      if (envPayee !== configPayee) {
        fail(`SOLANA_PAYEE_ADDRESS is ${envPayee || "empty"}, the program pays ${configPayee}`, `set SOLANA_PAYEE_ADDRESS=${configPayee}`);
      }
    }
  } catch (error) {
    fail(`could not read the program config (${error instanceof Error ? error.message : String(error)})`, "check SOLANA_RPC_URL and try again");
  }
}

console.log("\nKeys on this API");
try {
  const meter = loadMeterSigner(env);
  if (!meter) {
    fail("no meter key", "set SOLANA_METER_KEYPAIR to the meter.json of this program; without it nothing can be attested or closed");
  } else if (configMeter && meter.publicKey !== configMeter) {
    fail(`the meter key is ${meter.publicKey}, the program expects ${configMeter}`, "use the meter.json this program was initialized with");
  } else {
    ok(`meter key ${meter.publicKey} matches the program`);
  }
} catch (error) {
  fail(`the meter key could not be read (${error instanceof Error ? error.message : String(error)})`, "point SOLANA_METER_KEYPAIR at a solana-keygen JSON file");
}

let operator: Keypair | undefined;
try {
  const json = env.SOLANA_OPERATOR_KEYPAIR_JSON?.trim();
  const path = env.SOLANA_OPERATOR_KEYPAIR?.trim();
  if (json) operator = keypairFromJsonEnv(json, "SOLANA_OPERATOR_KEYPAIR_JSON");
  else if (path) operator = loadKeypair(path, "SOLANA_OPERATOR_KEYPAIR");
} catch (error) {
  fail(`the operator key could not be read (${error instanceof Error ? error.message : String(error)})`, "point SOLANA_OPERATOR_KEYPAIR at a solana-keygen JSON file");
}
if (!operator) {
  if (!env.SOLANA_OPERATOR_KEYPAIR?.trim() && !env.SOLANA_OPERATOR_KEYPAIR_JSON?.trim()) {
    fail("no operator key", "set SOLANA_OPERATOR_KEYPAIR; without it the deposit is not read from the escrow and the eSIM is never funded");
  }
} else {
  try {
    const lamports = await connection.getBalance(operator.publicKey);
    if (lamports < MIN_OPERATOR_LAMPORTS) {
      fail(`the operator ${operator.publicKey.toBase58()} holds ${lamports / 1e9} SOL`, "send it at least 0.01 SOL for fees (faucet.solana.com on devnet)");
    } else {
      ok(`operator ${operator.publicKey.toBase58()} holds ${lamports / 1e9} SOL`);
    }
  } catch (error) {
    fail(`could not read the operator balance (${error instanceof Error ? error.message : String(error)})`, "check SOLANA_RPC_URL and try again");
  }
  if (configPayee && operator.publicKey.toBase58() !== configPayee) {
    note("the operator is not the payee: claims and closes work, the treasury sweep does not");
  }
}

console.log("\nExposure");
const origin = env.FRONTEND_ORIGIN?.trim() ?? "";
if (citrusKey && origin !== "" && !/localhost|127\.0\.0\.1/.test(origin)) {
  fail(`FRONTEND_ORIGIN is ${origin}: this API is set up for a public app`, "run the real eSIM on a laptop; devnet USDC is free and anyone could spend the reseller balance");
} else {
  ok("local origin: the Citrus key is not behind a public app");
}

console.log(failures === 0 ? "\nReady. Start the API and follow docs/real-esim.md from step 3." : `\n${failures} thing${failures === 1 ? "" : "s"} to fix before the run.`);
process.exit(failures === 0 ? 0 : 1);
