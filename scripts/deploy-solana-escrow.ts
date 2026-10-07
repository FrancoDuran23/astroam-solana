// Deploy the AstroAm escrow to Solana devnet and initialize it with Circle's
// devnet USDC mint. Prints the program id the deploy command returns. If there
// is no key or no SOL, it prints the exact commands a human must run and
// exits. It never invents a program address.
//
// `--upgrade` replaces the code of a program whose config is already 106
// bytes (it stores the meter key). A shorter config cannot grow in place:
// deploy a new program instead. The key must be that program's upgrade
// authority. Escrows opened by the previous code still close and refund.
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  DEFAULT_ESCROW_TIMEOUT_SECONDS,
  SOLANA_RPC_URL,
  SOLANA_USDC_MINT,
} from "../src/shared/solana/constants.ts";

const SO_PATH = join("programs", "astroam-escrow", "target", "deploy", "astroam_escrow.so");
const UPGRADE = process.argv.includes("--upgrade");
/** tag, payee, mint, timeout, bump, meter. Matches CONFIG_LEN in the program. */
const CONFIG_LEN = 106;

function humanSteps(): string {
  return [
    "No Solana deployment was sent. There is no funded deployer key in this environment, and this script will not invent a program address.",
    "",
    "A human deploys the escrow to Solana devnet like this:",
    "",
    "  1. Install the Solana CLI (Agave):",
    "       sh -c \"$(curl -sSfL https://release.anza.xyz/stable/install)\"",
    "       export PATH=\"$HOME/.local/share/solana/install/active_release/bin:$PATH\"",
    "  2. Point it at devnet and create a key if you do not have one:",
    "       solana config set --url devnet",
    "       solana-keygen new -o ~/.config/solana/id.json",
    "  3. Fund the deployer with devnet SOL: https://faucet.solana.com",
    "       solana airdrop 2",
    "  4. The traveler wallet (Phantom, set to Devnet) needs SOL for fees and",
    "     Circle devnet USDC (mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU,",
    "     6 decimals): https://faucet.circle.com",
    "  5. Export the payee that should receive used USDC (it can be the deployer),",
    "     and create the meter key that signs usage vouchers. Do not reuse the",
    "     deployer key for the meter unless you mean to:",
    "       export SOLANA_PAYEE_ADDRESS=<base58 pubkey>",
    "       solana-keygen new -o ~/.config/solana/meter.json",
    "       export SOLANA_METER_KEYPAIR=~/.config/solana/meter.json",
    "     Optional: export SOLANA_DEPLOYER_KEYPAIR=~/.config/solana/id.json",
    "     Optional: export SOLANA_TIMEOUT_SECONDS=604800",
    "  6. From the repo root:",
    "       npm run solana:deploy",
    "  7. Copy the printed SOLANA_PROGRAM_ID, SOLANA_PAYEE_ADDRESS and",
    "     SOLANA_METER_PUBKEY into .env and restart the API. Do not paste an",
    "     address this script did not print. Keep SOLANA_METER_KEYPAIR on the",
    "     API host so it can sign vouchers. Never commit that file.",
    "",
    "The config is 106 bytes and stores the meter key. `npm run solana:upgrade`",
    "only replaces a program whose config is already that long, and the meter",
    "in SOLANA_METER_KEYPAIR must match the one already on-chain. The program",
    "at 8QXPo6yVxZuC3goYzHVLsxVkE1J6BaEqZvfW9e3Do2uq was initialized without a",
    "meter key, so it needs a fresh `npm run solana:deploy`, not an upgrade.",
    "",
    `USDC mint (Circle devnet, 6 decimals, SPL Token): ${SOLANA_USDC_MINT}`,
    `RPC: ${SOLANA_RPC_URL}`,
  ].join("\n");
}

// PATH is split with `;` on Windows, and the CLI there is `solana.exe`.
function onPath(name: string): boolean {
  const extensions = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  const found = (process.env.PATH ?? "")
    .split(delimiter)
    .filter((dir) => dir !== "")
    .some((dir) => extensions.some((ext) => existsSync(join(dir, name + ext))));
  return found;
}

function run(command: string, args: string[]): string {
  const child = spawnSync(command, args, { encoding: "utf8" });
  const output = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
  if (child.status !== 0) {
    console.error(output);
    console.error(`${command} exited ${child.status}`);
    process.exit(child.status ?? 1);
  }
  return output;
}

const keyPath = process.env.SOLANA_DEPLOYER_KEYPAIR?.trim() || join(homedir(), ".config", "solana", "id.json");
if (!onPath("solana") || !existsSync(keyPath)) {
  console.error(humanSteps());
  process.exit(1);
}

const secret = Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8")) as number[]);
const deployer = Keypair.fromSecretKey(secret);
const rpc = process.env.SOLANA_RPC_URL?.trim() || SOLANA_RPC_URL;
const connection = new Connection(rpc, "confirmed");
const balance = await connection.getBalance(deployer.publicKey);
if (balance === 0) {
  console.error(humanSteps());
  console.error(`Deployer ${deployer.publicKey.toBase58()} has 0 SOL on ${rpc}.`);
  process.exit(1);
}

const meter = readMeter();
const payeeRaw = process.env.SOLANA_PAYEE_ADDRESS?.trim() || deployer.publicKey.toBase58();
let payee: PublicKey;
try {
  payee = new PublicKey(payeeRaw);
} catch {
  console.error(`SOLANA_PAYEE_ADDRESS is not a Solana address: ${payeeRaw}`);
  process.exit(1);
}
const timeoutRaw = process.env.SOLANA_TIMEOUT_SECONDS?.trim();
const timeout = timeoutRaw ? Number(timeoutRaw) : DEFAULT_ESCROW_TIMEOUT_SECONDS;
if (!Number.isInteger(timeout) || timeout <= 0) {
  console.error("SOLANA_TIMEOUT_SECONDS must be a positive integer (seconds).");
  process.exit(1);
}

console.log(`Deployer: ${deployer.publicKey.toBase58()}`);
console.log(`Payee:    ${payee.toBase58()}`);
console.log(`Meter:    ${meter.toBase58()}`);
console.log(`USDC:     ${SOLANA_USDC_MINT}`);
console.log(`Timeout:  ${timeout} seconds`);

run("cargo", ["build-sbf", "--manifest-path", "programs/astroam-escrow/Cargo.toml"]);
if (!existsSync(SO_PATH)) {
  console.error(`Build did not produce ${SO_PATH}.`);
  process.exit(1);
}
const upgradeTarget = process.env.SOLANA_PROGRAM_ID?.trim();
if (UPGRADE && !upgradeTarget) {
  console.error("--upgrade needs SOLANA_PROGRAM_ID: the address of the program to replace.");
  process.exit(1);
}
if (UPGRADE) {
  await refuseShortConfig(new PublicKey(upgradeTarget!));
}
const deployed = run("solana", [
  "program",
  "deploy",
  SO_PATH,
  "--url",
  rpc,
  "--keypair",
  keyPath,
  ...(UPGRADE ? ["--program-id", upgradeTarget!] : []),
]);

// `solana program deploy` writes a program keypair next to the .so when
// --program-id is omitted. Prefer the id it prints over any local guess.
const printed = deployed.match(/Program Id:\s*([1-9A-HJ-NP-Za-km-z]+)/);
if (!printed?.[1]) {
  console.error("solana program deploy did not print a Program Id.");
  console.error(deployed);
  process.exit(1);
}
const programId = new PublicKey(printed[1]);

const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
const data = Buffer.alloc(1 + 8 + 32 + 32);
data[0] = 0;
data.writeBigInt64LE(BigInt(timeout), 1);
data.set(payee.toBytes(), 9);
data.set(meter.toBytes(), 41);
const mint = new PublicKey(SOLANA_USDC_MINT);

function printEnv(): void {
  console.log(`SOLANA_PROGRAM_ID=${programId.toBase58()}`);
  console.log(`SOLANA_PAYEE_ADDRESS=${payee.toBase58()}`);
  console.log(`SOLANA_METER_PUBKEY=${meter.toBase58()}`);
  console.log("SOLANA_ESCROW_SESSION_KEYS=true");
  if (process.env.SOLANA_METER_KEYPAIR?.trim()) {
    console.log(`SOLANA_METER_KEYPAIR=${process.env.SOLANA_METER_KEYPAIR.trim()}`);
  }
  console.log(`SOLANA_OPERATOR_KEYPAIR=${keyPath}`);
}

function readMeter(): PublicKey {
  const meterPath = process.env.SOLANA_METER_KEYPAIR?.trim();
  const raw = process.env.SOLANA_METER_PUBKEY?.trim();
  if (!meterPath && !raw) {
    console.error("Set SOLANA_METER_KEYPAIR (a solana-keygen JSON file) or SOLANA_METER_PUBKEY.");
    console.error("This script will not invent a meter key.");
    process.exit(1);
  }
  let fromFile: PublicKey | undefined;
  if (meterPath) {
    if (!existsSync(meterPath)) {
      console.error(`SOLANA_METER_KEYPAIR does not exist: ${meterPath}`);
      process.exit(1);
    }
    const secret = Uint8Array.from(JSON.parse(readFileSync(meterPath, "utf8")) as number[]);
    fromFile = Keypair.fromSecretKey(secret).publicKey;
  }
  if (!raw) return fromFile!;
  let given: PublicKey;
  try {
    given = new PublicKey(raw);
  } catch {
    console.error(`SOLANA_METER_PUBKEY is not a Solana address: ${raw}`);
    process.exit(1);
  }
  if (fromFile && !fromFile.equals(given)) {
    console.error(`SOLANA_METER_PUBKEY ${given.toBase58()} does not match SOLANA_METER_KEYPAIR ${fromFile.toBase58()}.`);
    process.exit(1);
  }
  return fromFile ?? given;
}

/** An in-place upgrade cannot add the meter field to a shorter config. */
async function refuseShortConfig(id: PublicKey): Promise<void> {
  const [existing] = PublicKey.findProgramAddressSync([Buffer.from("config")], id);
  const info = await connection.getAccountInfo(existing);
  if (!info) return;
  if (info.data.length < CONFIG_LEN) {
    console.error(
      `Config of ${id.toBase58()} is ${info.data.length} bytes. The meter key needs ${CONFIG_LEN}.`,
    );
    console.error("npm run solana:upgrade cannot add that field. Deploy a new program with npm run solana:deploy");
    console.error("(no --upgrade) and copy the new SOLANA_PROGRAM_ID this script prints.");
    process.exit(1);
  }
  const onChain = new PublicKey(info.data.subarray(74, 106));
  if (!onChain.equals(meter)) {
    console.error(`On-chain meter ${onChain.toBase58()} does not match ${meter.toBase58()}. Refusing to upgrade.`);
    process.exit(1);
  }
}

// An upgrade keeps the config account: the payee, mint, timeout and meter it was initialized with.
const existingConfig = await connection.getAccountInfo(config);
if (existingConfig !== null) {
  if (existingConfig.data.length < CONFIG_LEN) {
    console.error(`Config of ${programId.toBase58()} is ${existingConfig.data.length} bytes and has no meter key.`);
    console.error("Deploy a new program with npm run solana:deploy (no --upgrade).");
    process.exit(1);
  }
  const onChain = new PublicKey(existingConfig.data.subarray(74, 106));
  if (!onChain.equals(meter)) {
    console.error(`On-chain meter ${onChain.toBase58()} does not match ${meter.toBase58()}. The config was not changed.`);
    process.exit(1);
  }
  console.log("");
  console.log(`Program ${programId.toBase58()} is already initialized; its config was kept.`);
  printEnv();
  console.log("Add those lines to .env and restart the API. The meter key signs vouchers;");
  console.log("with the operator key the backend checkpoints, claims and closes by itself.");
  process.exit(0);
}

const tx = new Transaction().add(
  new TransactionInstruction({
    programId,
    keys: [
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  }),
);
const signature = await sendAndConfirmTransaction(connection, tx, [deployer]);
console.log("");
console.log(`Initialize tx: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
printEnv();
console.log("Add those lines to .env and restart the API. This is the id from solana program deploy, not a placeholder.");
console.log("SOLANA_METER_KEYPAIR is the key that signs vouchers. SOLANA_OPERATOR_KEYPAIR pays fees and sends checkpoint, claim and close.");
