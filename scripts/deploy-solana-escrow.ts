// Deploy the AstroAm escrow to Solana devnet and initialize it with Circle's
// devnet USDC mint. Prints the program id the deploy command returns. If there
// is no key or no SOL, it prints the exact commands a human must run and
// exits. It never invents a program address.
//
// `--upgrade` replaces the code of the program already at SOLANA_PROGRAM_ID
// and keeps its address and config. The key must be that program's upgrade
// authority. Escrows opened by the previous code still close and refund.
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
    "  5. Export the payee that should receive used USDC (it can be the deployer):",
    "       export SOLANA_PAYEE_ADDRESS=<base58 pubkey>",
    "     Optional: export SOLANA_DEPLOYER_KEYPAIR=~/.config/solana/id.json",
    "     Optional: export SOLANA_TIMEOUT_SECONDS=604800",
    "  6. From the repo root:",
    "       npm run solana:deploy",
    "  7. Copy the printed SOLANA_PROGRAM_ID and SOLANA_PAYEE_ADDRESS into .env",
    "     and restart the API. Do not paste an address this script did not print.",
    "",
    "To replace the code of the program already deployed (same address), run",
    "  npm run solana:upgrade",
    "with the key that deployed it and SOLANA_PROGRAM_ID set in .env.",
    "",
    `USDC mint (Circle devnet, 6 decimals, SPL Token): ${SOLANA_USDC_MINT}`,
    `RPC: ${SOLANA_RPC_URL}`,
  ].join("\n");
}

function onPath(name: string): boolean {
  const found = (process.env.PATH ?? "")
    .split(":")
    .some((dir) => existsSync(join(dir, name)));
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
const data = Buffer.alloc(1 + 8 + 32);
data[0] = 0;
data.writeBigInt64LE(BigInt(timeout), 1);
data.set(payee.toBytes(), 9);
const mint = new PublicKey(SOLANA_USDC_MINT);

function printEnv(): void {
  console.log(`SOLANA_PROGRAM_ID=${programId.toBase58()}`);
  console.log(`SOLANA_PAYEE_ADDRESS=${payee.toBase58()}`);
  console.log("SOLANA_ESCROW_SESSION_KEYS=true");
  console.log(`SOLANA_OPERATOR_KEYPAIR=${keyPath}`);
}

// An upgrade keeps the config account: the payee, mint and timeout it was initialized with.
if ((await connection.getAccountInfo(config)) !== null) {
  console.log("");
  console.log(`Program ${programId.toBase58()} is already initialized; its config was kept.`);
  printEnv();
  console.log("Add the last two lines to .env and restart the API: the app registers a session key at deposit,");
  console.log("and with the operator key the backend claims and closes by itself.");
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
console.log("SOLANA_OPERATOR_KEYPAIR lets the backend claim and close by itself; leave it out to keep the wallet sending the close.");
