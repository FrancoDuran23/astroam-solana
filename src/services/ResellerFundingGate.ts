// Reseller funding gate: Citrus auto-refill failure pauses new eSIM
// provisioning and new tranche top-ups until the reseller balance is refilled.
// Claims, closes and the treasury sweep keep running — those collect USDC
// that was already used, they do not spend more reseller USD.
//
// The flag is a file under DATA_DIR so a restart does not resume funding
// while the card is still failing. `CONNECTIVITY_PROVIDER=fake` uses the same
// gate; with no halt file, funding behaves as before.

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export type FundingHalt = {
  halted: boolean;
  reason?: string;
  eventId?: string;
  at?: string;
};

export interface ResellerFundingGate {
  isHalted(): boolean;
  getHaltReason(): string | null;
  halt(input: { reason: string; eventId?: string; at?: string }): void;
  resume(input?: { eventId?: string; at?: string }): void;
  recordAutoRefillFailed(reason: string, eventId?: string): Promise<void>;
  recordAutoRefillSucceeded(eventId?: string): Promise<void>;
  assertCanProvisionNewEsim(): void;
  assertCanTopUpTranche(): void;
  snapshot(): FundingHalt;
}

export class MemoryResellerFundingGate implements ResellerFundingGate {
  private state: FundingHalt = { halted: false };

  isHalted(): boolean {
    return this.state.halted;
  }

  getHaltReason(): string | null {
    return this.state.reason ?? null;
  }

  halt(input: { reason: string; eventId?: string; at?: string }): void {
    this.state = {
      halted: true,
      reason: input.reason,
      eventId: input.eventId,
      at: input.at ?? new Date().toISOString(),
    };
  }

  resume(input?: { eventId?: string; at?: string }): void {
    this.state = { halted: false, eventId: input?.eventId, at: input?.at ?? new Date().toISOString() };
  }

  async recordAutoRefillFailed(reason: string, eventId?: string): Promise<void> {
    this.halt({ reason, eventId });
  }

  async recordAutoRefillSucceeded(eventId?: string): Promise<void> {
    this.resume({ eventId });
  }

  assertCanProvisionNewEsim(): void {
    if (this.isHalted()) {
      throw new Error(`Citrus auto-refill failed: new eSIM provisioning is paused (${this.state.reason ?? 'reseller balance depleted'})`);
    }
  }

  assertCanTopUpTranche(): void {
    if (this.isHalted()) {
      throw new Error(`Citrus auto-refill failed: new tranche top-ups are paused (${this.state.reason ?? 'reseller balance depleted'})`);
    }
  }

  snapshot(): FundingHalt {
    return { ...this.state };
  }
}

const fileSchema = z.object({
  v: z.literal(1),
  halted: z.boolean(),
  reason: z.string().optional(),
  eventId: z.string().optional(),
  at: z.string().optional(),
});

function readHalt(filePath: string, logger: (line: Record<string, unknown>) => void): FundingHalt {
  if (!fs.existsSync(filePath)) return { halted: false };
  try {
    const parsed = fileSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
    return { halted: parsed.halted, reason: parsed.reason, eventId: parsed.eventId, at: parsed.at };
  } catch (error) {
    logger({
      level: "error",
      msg: "reseller funding halt file is unreadable — funding stays paused until it is replaced",
      detail: error instanceof Error ? error.message : String(error),
    });
    return { halted: true, reason: "halt_file_unreadable" };
  }
}

export class FileResellerFundingGate implements ResellerFundingGate {
  private state: FundingHalt;
  private readonly filePath: string;
  private readonly logger: (line: Record<string, unknown>) => void;

  constructor(filePath: string, logger: (line: Record<string, unknown>) => void = () => {}) {
    this.filePath = filePath;
    this.logger = logger;
    this.state = readHalt(filePath, logger);
  }

  isHalted(): boolean {
    return this.state.halted;
  }

  getHaltReason(): string | null {
    return this.state.reason ?? null;
  }

  halt(input: { reason: string; eventId?: string; at?: string }): void {
    this.state = {
      halted: true,
      reason: input.reason,
      eventId: input.eventId,
      at: input.at ?? new Date().toISOString(),
    };
    this.persist();
  }

  resume(input?: { eventId?: string; at?: string }): void {
    this.state = { halted: false, eventId: input?.eventId, at: input?.at ?? new Date().toISOString() };
    this.persist();
  }

  async recordAutoRefillFailed(reason: string, eventId?: string): Promise<void> {
    this.halt({ reason, eventId });
  }

  async recordAutoRefillSucceeded(eventId?: string): Promise<void> {
    this.resume({ eventId });
  }

  assertCanProvisionNewEsim(): void {
    if (this.isHalted()) {
      throw new Error(`Citrus auto-refill failed: new eSIM provisioning is paused (${this.state.reason ?? 'reseller balance depleted'})`);
    }
  }

  assertCanTopUpTranche(): void {
    if (this.isHalted()) {
      throw new Error(`Citrus auto-refill failed: new tranche top-ups are paused (${this.state.reason ?? 'reseller balance depleted'})`);
    }
  }

  snapshot(): FundingHalt {
    return { ...this.state };
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ v: 1, ...this.state })}\n`);
    fs.renameSync(tmp, this.filePath);
  }
}

/** Loads the halt flag from `filePath`, creating it on the next change. */
export function openResellerFundingGate(
  filePath: string,
  logger: (line: Record<string, unknown>) => void = () => {},
): ResellerFundingGate {
  return new FileResellerFundingGate(filePath, logger);
}
