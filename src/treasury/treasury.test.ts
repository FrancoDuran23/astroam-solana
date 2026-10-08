// Tests for TreasuryRouter, DisabledTreasury, FakeTreasury, CctpArqTreasury, and config guards.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DisabledTreasury, FakeTreasury } from './TreasuryRouter.ts'
import { bootTreasury, isEvmAddress } from './config.ts'

test('DisabledTreasury: rebalance does nothing and returns moved=false', async () => {
  const treasury = new DisabledTreasury()
  const result = await treasury.rebalance({ availableAtomic: 100_000_000n }) // 100 USDC atomic
  assert.equal(result.moved, false)
  if (!result.moved) {
    assert.equal(result.reason, 'treasury_disabled')
  }
})

test('FakeTreasury: rebalance below threshold moves nothing', async () => {
  const treasury = new FakeTreasury({
    minTransferAtomic: 50_000_000n, // 50 USDC
    targetBufferAtomic: 10_000_000n,
    keepAtomic: 10_000_000n,
  })
  const result = await treasury.rebalance({ availableAtomic: 40_000_000n }) // 40 USDC < 50 threshold
  assert.equal(result.moved, false)
  if (!result.moved) {
    assert.equal(result.reason, 'below_threshold')
  }
})

test('FakeTreasury: rebalance above threshold moves available minus keep amount', async () => {
  const treasury = new FakeTreasury({
    minTransferAtomic: 50_000_000n,
    targetBufferAtomic: 10_000_000n,
    keepAtomic: 10_000_000n,
  })
  const result = await treasury.rebalance({ availableAtomic: 100_000_000n }) // 100 USDC available
  assert.equal(result.moved, true)
  if (result.moved) {
    assert.equal(result.amountAtomic, 90_000_000n) // 100 - 10 = 90 USDC
    assert.ok(result.txHash.startsWith('fake-treasury-tx-'))
  }

  assert.equal(treasury.totalRouted, 90_000_000n)
  assert.equal(treasury.transfers.length, 1)
})

test('FakeTreasury: repeated execution is idempotent (only moves when above threshold)', async () => {
  const treasury = new FakeTreasury({
    minTransferAtomic: 50_000_000n,
    targetBufferAtomic: 10_000_000n,
    keepAtomic: 10_000_000n,
  })
  
  // First run: 100 USDC available -> 90 moved
  const res1 = await treasury.rebalance({ availableAtomic: 100_000_000n })
  assert.equal(res1.moved, true)

  // Second run: 10 USDC remaining (below min 50) -> 0 moved
  const res2 = await treasury.rebalance({ availableAtomic: 10_000_000n })
  assert.equal(res2.moved, false)
})

test('Config: default TREASURY_MODE is disabled', () => {
  const boot = bootTreasury({})
  assert.equal(boot.mode, 'disabled')
  assert.equal(boot.router.mode, 'disabled')
})

test('Config (FAIL-HARD): throws exception when TREASURY_MODE=cctp-arq without TREASURY_REAL_ENABLED=true', () => {
  assert.throws(
    () =>
      bootTreasury({
        TREASURY_MODE: 'cctp-arq',
        SOLANA_CLUSTER: 'mainnet-beta',
        POLYGON_NETWORK: 'mainnet',
        ARQ_POLYGON_USDC_ADDRESS: '0x1234567890123456789012345678901234567890',
      }),
    /TREASURY_REAL_ENABLED=true/,
  )
})

test('Config (FAIL-HARD): throws exception when mixing Solana devnet with real CCTP', () => {
  assert.throws(
    () =>
      bootTreasury({
        TREASURY_MODE: 'cctp-arq',
        TREASURY_REAL_ENABLED: 'true',
        SOLANA_CLUSTER: 'devnet',
        POLYGON_NETWORK: 'mainnet',
        ARQ_POLYGON_USDC_ADDRESS: '0x1234567890123456789012345678901234567890',
      }),
    /SOLANA_CLUSTER=mainnet-beta/,
  )
})

test('Config (FAIL-HARD): throws exception when ARQ address is missing or invalid EVM format', () => {
  assert.throws(
    () =>
      bootTreasury({
        TREASURY_MODE: 'cctp-arq',
        TREASURY_REAL_ENABLED: 'true',
        SOLANA_CLUSTER: 'mainnet-beta',
        POLYGON_NETWORK: 'mainnet',
        ARQ_POLYGON_USDC_ADDRESS: 'not-an-evm-address',
      }),
    /valid EVM ARQ_POLYGON_USDC_ADDRESS/,
  )
})

test('Config (FAIL-HARD): throws exception when optional EOA is invalid EVM address', () => {
  assert.throws(
    () =>
      bootTreasury({
        TREASURY_MODE: 'cctp-arq',
        TREASURY_REAL_ENABLED: 'true',
        SOLANA_CLUSTER: 'mainnet-beta',
        POLYGON_NETWORK: 'mainnet',
        ARQ_POLYGON_USDC_ADDRESS: '0x1234567890123456789012345678901234567890',
        POLYGON_TREASURY_EOA: 'invalid-eoa',
      }),
    /POLYGON_TREASURY_EOA must be a valid non-zero EVM address/,
  )
})

test('isEvmAddress: validates EVM address format correctly', () => {
  assert.equal(isEvmAddress('0x1234567890123456789012345678901234567890'), true)
  assert.equal(isEvmAddress('0x1234'), false)
  assert.equal(isEvmAddress('not-an-address'), false)
  assert.equal(isEvmAddress(undefined), false)
})
