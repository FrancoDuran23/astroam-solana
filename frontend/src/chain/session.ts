// Session key for a trip.
//
// The traveler's wallet signs one transaction: the deposit. That deposit
// registers this key in the escrow. The key does not sign usage vouchers:
// the program accepts only AstroAm's meter key, and the backend signs and
// sends checkpoint, claim and close with no wallet popup. The key lives in
// this browser's storage.
//
// Ed25519 from WebCrypto.

import { Buffer } from 'buffer'
import { PublicKey } from '@solana/web3.js'

type StoredSessionKey = { publicKey: string; pkcs8: string }

const storageKey = (missionId: string) => `astroam_session_key_${missionId}`

function read(missionId: string): StoredSessionKey | null {
  try {
    const raw = localStorage.getItem(storageKey(missionId))
    return raw ? (JSON.parse(raw) as StoredSessionKey) : null
  } catch {
    return null
  }
}

/** Creates and stores the trip's session key. Returns its base58 public key. */
export async function createSessionKey(missionId: string): Promise<string> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const publicKey = new PublicKey(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))).toBase58()
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64')
  localStorage.setItem(storageKey(missionId), JSON.stringify({ publicKey, pkcs8 } satisfies StoredSessionKey))
  return publicKey
}

/** base58 public key of the trip's session key, when this browser holds it. */
export function sessionPublicKey(missionId: string): string | undefined {
  return read(missionId)?.publicKey
}

/** Signs a voucher message with the session key. Null when this browser does not hold it. */
export async function signWithSessionKey(
  missionId: string,
  messageBase64: string,
): Promise<{ signature: Uint8Array; signer: string } | null> {
  const stored = read(missionId)
  if (!stored) return null
  const key = await crypto.subtle.importKey('pkcs8', Buffer.from(stored.pkcs8, 'base64'), { name: 'Ed25519' }, false, ['sign'])
  const signature = await crypto.subtle.sign({ name: 'Ed25519' }, key, Buffer.from(messageBase64, 'base64'))
  return { signature: new Uint8Array(signature), signer: stored.publicKey }
}
