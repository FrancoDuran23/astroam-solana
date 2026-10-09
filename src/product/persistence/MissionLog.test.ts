import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FileMissionLog, type MissionLogEntry } from './MissionLog.ts'

function entry(missionId: string, type: MissionLogEntry['type'], data: MissionLogEntry['data'] = {}): MissionLogEntry {
  return { v: 1, at: '2026-10-09T12:00:00.000Z', missionId, iccid: '8988000000000000001', type, data }
}

test('the file log keeps every entry in order and lists one trip at a time', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-log-'))
  const log = new FileMissionLog(dir)
  log.append(entry('m_a', 'esim.provisioned', { isMock: true }))
  log.append(entry('m_b', 'esim.provisioned', { isMock: true }))
  log.append(entry('m_a', 'usage.reading', { meteredBytes: '240000000' }))

  const entries = await log.list('m_a')
  assert.deepEqual(entries.map((e) => e.type), ['esim.provisioned', 'usage.reading'])
  assert.equal(entries[1]!.data.meteredBytes, '240000000')
  assert.equal(fs.readFileSync(log.filePath, 'utf-8').trim().split('\n').length, 3)
})

test('a line cut short by a crash is skipped, not fatal', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-log-'))
  const log = new FileMissionLog(dir)
  log.append(entry('m_a', 'esim.provisioned'))
  fs.appendFileSync(log.filePath, '{"v":1,"missionId":"m_a","ty')
  fs.appendFileSync(log.filePath, '\n')
  log.append(entry('m_a', 'esim.paused', { reason: 'traveler' }))

  assert.deepEqual((await log.list('m_a')).map((e) => e.type), ['esim.provisioned', 'esim.paused'])
})

test('a log that was never written lists nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-log-'))
  assert.deepEqual(await new FileMissionLog(dir).list('m_a'), [])
})
