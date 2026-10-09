import fs from 'node:fs'
import path from 'node:path'

/**
 * What happened to a trip, in order: the eSIM it got, each usage reading and
 * what that usage cost, the funding, the escrow transactions and the close.
 * Append-only: a line is never rewritten, so it is an audit trail.
 */
export type MissionLogType =
  | 'esim.provisioned'
  | 'esim.funded'
  | 'esim.paused'
  | 'esim.resumed'
  | 'usage.baseline'
  | 'usage.reading'
  | 'usage.demo_traffic'
  | 'voucher.signed'
  | 'escrow.checkpoint'
  | 'escrow.claim'
  | 'mission.closed'

export type MissionLogEntry = {
  v: 1
  at: string
  missionId: string
  iccid: string | null
  type: MissionLogType
  /** Money and byte counts are digit strings, never floats of atomic units. */
  data: Record<string, string | number | boolean | null>
}

export interface MissionLog {
  append(entry: MissionLogEntry): void
  list(missionId: string): Promise<MissionLogEntry[]>
}

function isEntry(value: unknown): value is MissionLogEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return entry.v === 1 && typeof entry.missionId === 'string' && typeof entry.type === 'string' && typeof entry.at === 'string'
}

/** One JSON line per entry at `{DATA_DIR}/mission-log.jsonl`, next to `missions.json`. */
export class FileMissionLog implements MissionLog {
  readonly filePath: string

  constructor(dataDir?: string) {
    const dir = dataDir || process.env.DATA_DIR || './data'
    this.filePath = path.resolve(dir, 'mission-log.jsonl')
  }

  // Synchronous on purpose: entries from one trip land in the order they were written.
  append(entry: MissionLogEntry): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    fs.appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf-8')
  }

  async list(missionId: string): Promise<MissionLogEntry[]> {
    let content: string
    try {
      content = await fs.promises.readFile(this.filePath, 'utf-8')
    } catch {
      return []
    }
    const entries: MissionLogEntry[] = []
    for (const line of content.split('\n')) {
      if (line === '') continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        // A line cut short by a crash; the rest of the log is still good.
        continue
      }
      if (isEntry(parsed) && parsed.missionId === missionId) entries.push(parsed)
    }
    return entries
  }
}

export class MemoryMissionLog implements MissionLog {
  private entries: MissionLogEntry[] = []

  append(entry: MissionLogEntry): void {
    this.entries.push(structuredClone(entry))
  }

  async list(missionId: string): Promise<MissionLogEntry[]> {
    return this.entries.filter((entry) => entry.missionId === missionId).map((entry) => structuredClone(entry))
  }
}
