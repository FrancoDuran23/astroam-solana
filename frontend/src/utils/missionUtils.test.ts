import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { estimateMb, fmtMb, DESTINATIONS } from './missionUtils.ts'

describe('missionUtils tariff & estimation', () => {
  it('estimates Brazil 10 USDC as exactly 4000 MB = 4.0 GB', () => {
    const brazil = DESTINATIONS.find((d) => d.id === 'brazil')
    assert.ok(brazil)
    assert.equal(brazil.pricePerMbUsdc, 0.0025)

    const mb = estimateMb(10, brazil.pricePerMbUsdc)
    assert.equal(mb, 4000)

    const formatted = fmtMb(mb)
    assert.equal(formatted, '4.0 GB')
  })

  it('returns 0 and handles missing tariff gracefully', () => {
    assert.equal(estimateMb(10, undefined), 0)
    assert.equal(estimateMb(10, 0), 0)
    assert.equal(fmtMb(0), '0 MB')
  })
})
