// Network identifiers, chain-agnostic. A network is a `<chain>:<name>` string
// such as "monad:testnet"; which networks are valid is decided by the payment
// rail in use (src/rails/), never hardcoded here.

const NETWORK_RE = /^[a-z0-9-]+:[a-z0-9-]+$/;

export type Network = string;

export function isNetwork(value: unknown): value is Network {
  return typeof value === "string" && NETWORK_RE.test(value);
}

/**
 * Sanitizes a network id for use inside a filename: the `:` in
 * `"monad:testnet"` is an Alternate-Data-Stream separator on NTFS, where
 * `fs.renameSync` rejects it with `EINVAL`.
 */
export function sanitizeNetworkForFilename(network: string): string {
  return network.replace(/:/g, "-");
}
