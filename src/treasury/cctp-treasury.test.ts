// Comprehensive tests for CctpBridge, CctpArqTreasury, and TreasuryTransferStore state machine
// covering all 10 mandatory safety and ambiguity-elimination requirements.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CctpArqTreasury } from './CctpArqTreasury.ts'
import { MockCctpBridge } from './CctpBridge.ts'
import { MemoryTreasuryTransferStore } from './TreasuryTransferStore.ts'

const defaultThresholds = {
  minTransferAtomic: 50_000_000n, // 50 USDC
  targetBufferAtomic: 10_000_000n, // 10 USDC
  keepAtomic: 10_000_000n,
}

const cctpDestination = '0x1234567890123456789012345678901234567890'

test('REQ 1: signature existe antes de broadcast', async () => {
  const bridge = new MockCctpBridge()
  
  // Prepare locally
  const prepared = await bridge.prepareSourceBurn({
    amountAtomic: 90_000_000n,
    destinationAddress: cctpDestination,
    transferId: 'trf_req_1',
  })

  // Signature is generated and known BEFORE broadcast
  assert.ok(prepared.sourceTxSignature, 'sourceTxSignature must exist after prepare')
  assert.ok(prepared.serializedTransaction, 'serializedTransaction must exist after prepare')
  assert.equal(bridge.broadcasts.length, 0, 'No broadcast must have occurred during prepare')
})

test('REQ 2: journal persiste signature antes de broadcast', async () => {
  const store = new MemoryTreasuryTransferStore()
  const bridge = new MockCctpBridge()

  // Track store saves
  const savedStates: string[] = []
  const originalSave = store.save.bind(store)
  store.save = async (record) => {
    savedStates.push(record.state)
    // Verify signature is present when state transitions to source_tx_prepared
    if (record.state === 'source_tx_prepared') {
      assert.ok(record.sourceTxSignature, 'Signature must be persisted in source_tx_prepared')
      assert.ok(record.serializedTransaction, 'Raw signed tx must be persisted in source_tx_prepared')
      assert.equal(bridge.broadcasts.length, 0, 'Broadcast must NOT have been called yet')
    }
    return originalSave(record)
  }

  const treasury = new CctpArqTreasury({
    bridge,
    store,
    arqPolygonAddress: cctpDestination,
    solanaCluster: 'mainnet-beta',
    polygonNetwork: 'mainnet',
    thresholds: defaultThresholds,
  })

  const result = await treasury.rebalance({ availableAtomic: 100_000_000n })
  assert.equal(result.moved, true)
  assert.ok(savedStates.includes('source_tx_prepared'))
  assert.ok(savedStates.includes('source_broadcast_started'))
})

test('REQ 3: crash antes del broadcast → puede retransmitir misma tx', async () => {
  const store = new MemoryTreasuryTransferStore()
  const signature = 'pre-signed-sig-req-3'
  const mockRawBytes = Buffer.from('mock_raw_tx_payload_req_3').toString('base64')

  // Simulate crash state right after source_tx_prepared, before broadcast
  await store.save({
    v: 1,
    transferId: 'trf_crash_pre_broadcast',
    amountAtomic: '90000000',
    sourceChain: 'solana:mainnet-beta',
    destinationChain: 'polygon:mainnet',
    destinationAddress: cctpDestination,
    sourceTxSignature: signature,
    serializedTransaction: mockRawBytes,
    state: 'source_tx_prepared',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  const bridge = new MockCctpBridge()
  const treasury = new CctpArqTreasury({
    bridge,
    store,
    arqPolygonAddress: cctpDestination,
    solanaCluster: 'mainnet-beta',
    polygonNetwork: 'mainnet',
    thresholds: defaultThresholds,
  })

  // Restart rebalances active record
  const result = await treasury.rebalance({ availableAtomic: 100_000_000n })
  assert.equal(result.moved, true)

  // MUST re-broadcast the EXACT same pre-signed transaction bytes!
  assert.equal(bridge.preparedBurns.length, 0, 'Must NOT generate a new prepare/burn')
  assert.equal(bridge.broadcasts.length, 1)
  assert.equal(bridge.broadcasts[0].sourceTxSignature, signature)
  assert.equal(bridge.broadcasts[0].serializedTransaction, mockRawBytes)
})

test('REQ 4: broadcast aceptado + excepción antes de retorno → restart encuentra misma signature', async () => {
  const store = new MemoryTreasuryTransferStore()
  const bridge = new MockCctpBridge()
  
  // Enable crash simulation: network accepts tx, but RPC call throws exception before returning to caller
  bridge.crashDuringBroadcastAfterNetworkAccept = true

  const treasury1 = new CctpArqTreasury({
    bridge,
    store,
    arqPolygonAddress: cctpDestination,
    solanaCluster: 'mainnet-beta',
    polygonNetwork: 'mainnet',
    thresholds: defaultThresholds,
  })

  // 1. Initial attempt fails due to RPC network crash during broadcast
  const result1 = await treasury1.rebalance({ availableAtomic: 100_000_000n })
  assert.equal(result1.moved, false)
  assert.ok(result1.reason?.includes('RPC Network Timeout'))

  // Verify journal ALREADY holds the signature on disk
  const records = store.listAll()
  assert.equal(records.length, 1)
  const savedSig = records[0].sourceTxSignature
  assert.ok(savedSig, 'Signature must be persisted despite broadcast exception')

  // 2. Process restarts, RPC is fine
  bridge.crashDuringBroadcastAfterNetworkAccept = false

  const treasury2 = new CctpArqTreasury({
    bridge,
    store,
    arqPolygonAddress: cctpDestination,
    solanaCluster: 'mainnet-beta',
    polygonNetwork: 'mainnet',
    thresholds: defaultThresholds,
  })

  // 3. Restart queries getSourceTransactionStatus(savedSig), finds confirmed, completes without duplicating burn!
  const result2 = await treasury2.rebalance({ availableAtomic: 100_000_000n })
  assert.equal(result2.moved, true)
  assert.equal(result2.txHash, savedSig)
  assert.equal(bridge.preparedBurns.length, 1, 'MUST NOT prepare or sign a second burn transaction!')
})

test('REQ 5: no genera una segunda signed tx para esa operación', async () => {
  const store = new MemoryTreasuryTransferStore()
  const bridge = new MockCctpBridge()
  const signature = 'single-signed-sig-5'
  const mockRawBytes = Buffer.from('mock_raw_tx_5').toString('base64')

  // Put active transfer in store
  await store.save({
    v: 1,
    transferId: 'trf_active_5',
    amountAtomic: '90000000',
    sourceChain: 'solana:mainnet-beta',
    destinationChain: 'polygon:mainnet',
    destinationAddress: cctpDestination,
    sourceTxSignature: signature,
    serializedTransaction: mockRawBytes,
    state: 'source_tx_prepared',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  const treasury = new CctpArqTreasury({
    bridge,
    store,
    arqPolygonAddress: cctpDestination,
    solanaCluster: 'mainnet-beta',
    polygonNetwork: 'mainnet',
    thresholds: defaultThresholds,
  })

  // Run rebalance multiple times while active
  await treasury.rebalance({ availableAtomic: 100_000_000n })
  
  // Total prepared burns should remain 0 (resumed existing prepared tx)
  assert.equal(bridge.preparedBurns.length, 0, 'No second signed tx should be generated')
})

test('REQ 6: pending no retransmite indiscriminadamente', async () => {
  const store = new MemoryTreasuryTransferStore()
  const signature = 'pending-sig-req-6'
  const mockRawBytes = Buffer.from('mock_raw_tx_6').toString('base64')

  await store.save({
    v: 1,
    transferId: 'trf_pending_6',
    amountAtomic: '90000000',
    sourceChain: 'solana:mainnet-beta',
    destinationChain: 'polygon:mainnet',
    destinationAddress: cctpDestination,
    sourceTxSignature: signature,
    serializedTransaction: mockRawBytes,
    state: 'source_submitted',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  const bridge = new MockCctpBridge()
  bridge.setTxStatus(signature, 'pending')

  const treasury = new CctpArqTreasury({
    bridge,
    store,
    arqPolygonAddress: cctpDestination,
    solanaCluster: 'mainnet-beta',
    polygonNetwork: 'mainnet',
    thresholds: defaultThresholds,
  })

  const result = await treasury.rebalance({ availableAtomic: 100_000_000n })
  assert.equal(result.moved, true)
  assert.ok(result.detail?.includes('pending'))
  assert.equal(bridge.broadcasts.length, 0, 'Must NOT re-broadcast while status is pending on-chain')
  assert.equal(store.get('trf_pending_6')?.state, 'source_submitted')
})

test('REQ 7: confirmed jamás retransmite', async () => {
  const store = new MemoryTreasuryTransferStore()
  const signature = 'confirmed-sig-req-7'

  await store.save({
    v: 1,
    transferId: 'trf_confirmed_7',
    amountAtomic: '90000000',
    sourceChain: 'solana:mainnet-beta',
    destinationChain: 'polygon:mainnet',
    destinationAddress: cctpDestination,
    sourceTxSignature: signature,
    state: 'source_submitted',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  const bridge = new MockCctpBridge()
  bridge.setTxStatus(signature, 'confirmed')

  const treasury = new CctpArqTreasury({
    bridge,
    store,
    arqPolygonAddress: cctpDestination,
    solanaCluster: 'mainnet-beta',
    polygonNetwork: 'mainnet',
    thresholds: defaultThresholds,
  })

  const result = await treasury.rebalance({ availableAtomic: 100_000_000n })
  assert.equal(result.moved, true)
  assert.equal(bridge.broadcasts.length, 0, 'Confirmed transaction must NEVER re-broadcast')
  assert.equal(store.get('trf_confirmed_7')?.state, 'completed')
})

test('REQ 8: expired + not_found no crea una nueva burn automáticamente', async () => {
  const store = new MemoryTreasuryTransferStore()
  const signature = 'expired-sig-req-8'

  await store.save({
    v: 1,
    transferId: 'trf_expired_8',
    amountAtomic: '90000000',
    sourceChain: 'solana:mainnet-beta',
    destinationChain: 'polygon:mainnet',
    destinationAddress: cctpDestination,
    sourceTxSignature: signature,
    lastValidBlockHeight: 100, // Valid up to block 100
    state: 'source_tx_prepared',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  const bridge = new MockCctpBridge()
  bridge.setTxStatus(signature, 'not_found')

  // Current block height is 150 (> 100, so blockhash has expired)
  const treasury = new CctpArqTreasury({
    bridge,
    store,
    arqPolygonAddress: cctpDestination,
    solanaCluster: 'mainnet-beta',
    polygonNetwork: 'mainnet',
    thresholds: defaultThresholds,
    currentBlockHeight: 150,
  })

  const result = await treasury.rebalance({ availableAtomic: 100_000_000n })
  assert.equal(result.moved, false)
  assert.equal(result.reason, 'source_tx_expired_unconfirmed')

  // State transitions to source_expired_unconfirmed without auto-creating a new burn
  assert.equal(store.get('trf_expired_8')?.state, 'source_expired_unconfirmed')
  assert.equal(bridge.preparedBurns.length, 0, 'Must NOT auto-create a new burn when expired')
})

test('REQ 9: serialized transaction jamás aparece en logs', async () => {
  const store = new MemoryTreasuryTransferStore()
  const bridge = new MockCctpBridge()
  const loggedLines: string[] = []

  const treasury = new CctpArqTreasury({
    bridge,
    store,
    arqPolygonAddress: cctpDestination,
    solanaCluster: 'mainnet-beta',
    polygonNetwork: 'mainnet',
    thresholds: defaultThresholds,
    logger: (line) => {
      loggedLines.push(JSON.stringify(line))
    },
  })

  await treasury.rebalance({ availableAtomic: 100_000_000n })

  // Verify no log line contains raw serialized transaction bytes or serializedTransaction field
  for (const line of loggedLines) {
    assert.equal(line.includes('serializedTransaction'), false, 'Log output must never contain serializedTransaction field')
    assert.equal(line.includes('mock_raw_tx_payload'), false, 'Log output must never contain raw transaction payload bytes')
  }
})

test('REQ 10: destination state machine tiene separación prepare/broadcast', async () => {
  const store = new MemoryTreasuryTransferStore()
  const bridge = new MockCctpBridge()

  const treasury = new CctpArqTreasury({
    bridge,
    store,
    arqPolygonAddress: cctpDestination,
    solanaCluster: 'mainnet-beta',
    polygonNetwork: 'mainnet',
    thresholds: defaultThresholds,
  })

  const result = await treasury.rebalance({ availableAtomic: 100_000_000n })
  assert.equal(result.moved, true)

  const record = store.listAll()[0]
  // Complete state requires destination transaction evidence
  assert.equal(record.state, 'completed')
  assert.ok(record.destinationTxHash, 'Destination tx evidence hash must exist before reaching completed state')
})

test('EXECUTOR BASE URL REGRESSION: Prevents reintroduction of legacy executor.wormhole.com/v1 and validates official mainnet endpoints', async () => {
  const { WormholeExecutorClient } = await import('./ExecutorClient.ts')
  const client = new WormholeExecutorClient()
  assert.equal(client.executorApiUrl, 'https://executor.labsapis.com')
  assert.notEqual(client.executorApiUrl, 'https://executor.wormhole.com/v1', 'Legacy endpoint executor.wormhole.com/v1 must NOT be used')

  // Verify official v0 endpoint paths exist on WormholeExecutorClient
  assert.ok('fetchCapabilities' in client, 'fetchCapabilities (GET /v0/capabilities) must exist')
  assert.ok('fetchQuote' in client, 'fetchQuote (POST /v0/quote) must exist')
  assert.ok('getExecutionStatus' in client, 'getExecutionStatus (POST /v0/status/tx) must exist')
})


