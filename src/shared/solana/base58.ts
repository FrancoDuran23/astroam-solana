const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE_MAP = new Uint8Array(256).fill(255);
for (let i = 0; i < ALPHABET.length; i++) BASE_MAP[ALPHABET.charCodeAt(i)] = i;

export function encodeBase58(source: Uint8Array): string {
  if (source.length === 0) return "";
  const digits = [0];
  for (let i = 0; i < source.length; i++) {
    let carry = source[i]!;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (let i = 0; source[i] === 0 && i < source.length - 1; i++) out += "1";
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]!]!;
  return out;
}

export function decodeBase58(source: string): Uint8Array {
  if (source.length === 0) return new Uint8Array();
  const bytes = [0];
  for (let i = 0; i < source.length; i++) {
    const value = BASE_MAP[source.charCodeAt(i)]!;
    if (value === 255) throw new Error(`Non-base58 character in "${source}"`);
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; source[i] === "1" && i < source.length - 1; i++) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

export function isSolanaAddress(value: string | undefined | null): boolean {
  if (!value) return false;
  try {
    return decodeBase58(value.trim()).length === 32;
  } catch {
    return false;
  }
}

/** A Solana transaction signature is the base58 encoding of 64 bytes. */
export function isSolanaSignature(value: string | undefined | null): boolean {
  if (!value) return false;
  try {
    return decodeBase58(value.trim()).length === 64;
  } catch {
    return false;
  }
}
