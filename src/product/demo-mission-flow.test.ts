// Demo flow with no real services (FakeProvider + a simulated payments agent
// per mission), as `npm run server` starts it with the .env.example.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { MissionProductService } from './services/MissionProductService.ts'
import type { MissionRepository } from './persistence/MissionRepository.ts'
import type { ProductMission } from './types/mission.ts'
import { FakeRail } from '../rails/FakeRail.ts'
import { FakeProvider } from '../providers/connectivity/FakeProvider.ts'

class MemoryRepo implements MissionRepository {
  private store = new Map<string, ProductMission>()

  async save(mission: ProductMission): Promise<void> {
    this.store.set(mission.id, structuredClone(mission))
  }

  async findById(id: string): Promise<ProductMission | null> {
    const mission = this.store.get(id)
    return mission ? structuredClone(mission) : null
  }

  async findByPaymentIntentId(intentId: string): Promise<ProductMission | null> {
    for (const m of this.store.values()) {
      if (m.paymentIntentId === intentId) return structuredClone(m)
    }
    return null
  }

  async findAll(): Promise<ProductMission[]> {
    return Array.from(this.store.values(), (m) => structuredClone(m))
  }
}

const BRASIL = {
  id: 'br',
  name: 'Brasil',
  flag: 'BR',
  network: 'Vivo',
  coverage: '4G/5G',
  pricePerMbUsdc: 0.0025,
}

let service: MissionProductService

before(() => {
  process.env.ENABLE_DEMO_TRAFFIC = 'true'
  delete process.env.ASTROAM_LIVE_ENABLED
  delete process.env.PRICE_PER_MB_RAW
  delete process.env.PRICE_PER_MIB_RAW
  delete process.env.CHANNEL_CONTRACT

  service = new MissionProductService({
    repo: new MemoryRepo(),
    connectivity: new FakeProvider(),
    rail: new FakeRail(),
  })
})

async function activeMission(budgetUsdc: number): Promise<string> {
  const { id } = await service.createMission({
    destination: BRASIL,
    startDate: '2026-10-01',
    endDate: '2026-10-04',
    budgetUsdc,
    dailyLimitUsdc: budgetUsdc,
  })
  const intent = await service.createPaymentIntent(id)
  await service.confirmPayment(id, intent.intentId, 'demo_tx_hash')
  await service.activateMission(id)
  return id
}

test('the deposit opens a payment channel for the mission', async () => {
  const id = await activeMission(5)
  const mission = await service.getMission(id)
  assert.match(mission.channelId ?? '', /^0x[0-9a-f]{40}$/)
})

test('demo traffic signs vouchers and charges the destination rate, without pausing early', async () => {
  const id = await activeMission(5) // 5 USDC a 0,0025 USDC/MB = 2.000 MB

  const legs = [300, 700, 800]
  for (const mb of legs) {
    const res = await service.processDemoTraffic(id, mb * 1_000_000)
    assert.equal(res.voucher.kind, 'signed', `${mb} MB leg without a signed voucher`)
    assert.equal(res.status, 'active', `the mission paused on the ${mb} MB leg`)
  }

  const last = await service.processDemoTraffic(id, 600 * 1_000_000) // 2.400 MB > 2.000
  assert.equal(last.voucher.kind, 'unsigned')
  assert.equal(last.status, 'paused')
})

test('the mission log records the eSIM, each usage reading, and the pause when the budget runs out', async () => {
  const id = await activeMission(5)
  await service.processDemoTraffic(id, 300 * 1_000_000)
  await service.processDemoTraffic(id, 1_800 * 1_000_000) // 2.100 MB > 2.000

  const entries = await service.getMissionLog(id)
  assert.deepEqual(
    entries.map((e) => e.type),
    ['esim.provisioned', 'usage.demo_traffic', 'usage.demo_traffic', 'esim.paused'],
  )
  const mission = await service.getMission(id)
  assert.equal(entries[0]!.iccid, mission.iccid)
  assert.equal(entries[0]!.data.isMock, true)
  assert.equal(entries[1]!.data.meteredBytes, '300000000')
  assert.equal(entries[1]!.data.consumedUsdc, 0.75)
  assert.equal(entries[2]!.data.meteredBytes, '2100000000')
  assert.equal(entries[3]!.data.reason, 'budget_exhausted')
})

test('the mission log is per mission', async () => {
  const a = await activeMission(5)
  const b = await activeMission(5)
  await service.processDemoTraffic(a, 100 * 1_000_000)
  assert.deepEqual((await service.getMissionLog(b)).map((e) => e.type), ['esim.provisioned'])
  await assert.rejects(service.getMissionLog('m_missing'))
})

test('the vouchers of two missions do not collide', async () => {
  const a = await activeMission(5)
  const b = await activeMission(5)

  await service.processDemoTraffic(a, 1_000 * 1_000_000)
  const res = await service.processDemoTraffic(b, 300 * 1_000_000)
  assert.equal(res.voucher.kind, 'signed', 'the second mission should not see the voucher of the first')
})

test('the demo eSIM comes with a valid QR image', async () => {
  const id = await activeMission(5)
  const mission = await service.getMission(id)
  const qr = mission.esim?.qrCode ?? ''
  assert.match(qr, /^data:image\/svg\+xml;base64,/)
  assert.match(Buffer.from(qr.split(',')[1]!, 'base64').toString('utf8'), /^<svg /)
})
