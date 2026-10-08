// Tests for ResellerFundingGate behavior and CitrusWebhookHandler integration.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { MemoryResellerFundingGate, FileResellerFundingGate } from '../services/ResellerFundingGate.ts'
import { CitrusWebhookHandler } from '../services/CitrusWebhookHandler.ts'
import { WebhookEventLog } from '../persistence/webhook-event.ts'

test('ResellerFundingGate: default state is open', () => {
  const gate = new MemoryResellerFundingGate()
  assert.equal(gate.isHalted(), false)
  assert.doesNotThrow(() => gate.assertCanProvisionNewEsim())
  assert.doesNotThrow(() => gate.assertCanTopUpTranche())
})

test('ResellerFundingGate: auto refill failure halts gate and throws on provision & topup', async () => {
  const gate = new MemoryResellerFundingGate()
  await gate.recordAutoRefillFailed('Insufficient credit card funds')

  assert.equal(gate.isHalted(), true)
  assert.equal(gate.getHaltReason(), 'Insufficient credit card funds')

  assert.throws(() => gate.assertCanProvisionNewEsim(), /Citrus auto-refill failed/)
  assert.throws(() => gate.assertCanTopUpTranche(), /Citrus auto-refill failed/)
})

test('ResellerFundingGate: auto refill succeeded resumes gate', async () => {
  const gate = new MemoryResellerFundingGate()
  await gate.recordAutoRefillFailed('Failed')
  assert.equal(gate.isHalted(), true)

  await gate.recordAutoRefillSucceeded()
  assert.equal(gate.isHalted(), false)
  assert.equal(gate.getHaltReason(), null)
  assert.doesNotThrow(() => gate.assertCanProvisionNewEsim())
  assert.doesNotThrow(() => gate.assertCanTopUpTranche())
})

test('ResellerFundingGate: persistence to file preserves state across reloads', async () => {
  const testPath = join(process.cwd(), 'scratch', `test_gate_${Date.now()}.json`)

  try {
    const gate1 = new FileResellerFundingGate(testPath)
    await gate1.recordAutoRefillFailed('Card expired')

    const gate2 = new FileResellerFundingGate(testPath)
    assert.equal(gate2.isHalted(), true)
    assert.equal(gate2.getHaltReason(), 'Card expired')
  } finally {
    try {
      rmSync(testPath, { force: true })
    } catch {}
  }
})

test('CitrusWebhookHandler: triggers funding gate on balance events', async () => {
  const logPath = join(process.cwd(), 'scratch', `test_wh_events_${Date.now()}.jsonl`)
  try {
    const gate = new MemoryResellerFundingGate()
    const log = WebhookEventLog.open(logPath)
    const esimStore = {
      get: () => undefined,
      update: async () => {},
    } as any

    const handler = new CitrusWebhookHandler({
      log,
      esimStore,
      fundingGate: gate,
    })

    // balance.auto_refill_failed event
    const res1 = await handler.handle({
      id: 'evt_1',
      event: 'balance.auto_refill_failed',
      created_at: new Date().toISOString(),
      reason: 'Payment method declined',
    })
    assert.equal(res1.accepted, true)
    assert.equal(gate.isHalted(), true)

    // balance.topped_up event
    const res2 = await handler.handle({
      id: 'evt_2',
      event: 'balance.topped_up',
      created_at: new Date().toISOString(),
    })
    assert.equal(res2.accepted, true)
    assert.equal(gate.isHalted(), false)
  } finally {
    try {
      rmSync(logPath, { force: true })
    } catch {}
  }
})
