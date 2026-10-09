/**
 * The meter's port to the payments agent: `POST /vouchers` (cumulative
 * vouchers over the one-way payment channel of the rail in use).
 *
 * It is the only seam between the connectivity/meter layer and the payments
 * layer (src/rails/PaymentRail.ts): one HTTP request with message 1 (M1),
 * one response with message 2 (M2). The schemas and the `reason` vocabulary
 * are NOT duplicated here. They are reused from `src/shared/`
 * (`messages.ts`, `reasons.ts`, `money.ts`, `retry.ts`).
 *
 * Three pieces:
 * - `createHttpVoucherPort`: one attempt against the real agent (auth with
 *   `X-Gateway-Token`, M1 validated before it leaves, M2 validated on return).
 * - `withVoucherRetry`: a decorator that retries ONLY what is retryable
 *   (`retryable: true` in M2, or a transport failure), with the total
 *   deadline bounded by FT-R3. A `retryable: false` is never retried.
 * - `createInMemoryVoucherPort`: an offline double that mimics the agent's
 *   rules (idempotency by cumulative amount, exhaustion against the deposit)
 *   for the demo and the tests, with no network.
 */

import { createHash } from "node:crypto";
import {
  buildUnsigned,
  message1Schema,
  message2Schema,
  message2SignedSchema,
  type Message1,
  type Message2,
} from "../shared/messages.ts";
import { computeExpectedAmountRaw } from "../shared/money.ts";
import { RetryDeadlineExceededError, TimeoutError, withRetry, type RetryOptions } from "../shared/retry.ts";
import type { Network } from "../shared/network.ts";

/** Port consumed by `IntegratedMeterService`. It ALWAYS returns a valid M2
 * envelope (signed or unsigned); anything else (network down, 401, 400, a
 * body that is not M2) is a `VoucherTransportError`. */
export type VoucherPort = {
  requestVoucher(m1: Message1): Promise<Message2>;
};

/** A failure that is NOT a business result from the agent: transport, auth
 * (401), schema (400) or a response that breaks the M2 contract.
 * `retryable` tells "ask again" (network, 5xx) apart from "retrying is
 * pointless" (misconfigured token, invalid M1). */
export class VoucherTransportError extends Error {
  readonly retryable: boolean;
  readonly httpStatus: number | undefined;

  constructor(detail: string, options: { retryable: boolean; httpStatus?: number }) {
    super(detail);
    this.name = "VoucherTransportError";
    this.retryable = options.retryable;
    this.httpStatus = options.httpStatus;
  }
}

// ---------------------------------------------------------------------------
// Building message 1
// ---------------------------------------------------------------------------

export type MeterReadingInput = {
  sessionId: string;
  /** Payment channel id, as formatted by the rail in use. */
  channel: string;
  network: Network;
  /** Bytes accumulated since the channel opened (VE-R4), never a delta. */
  cumulativeBytes: number;
  /** `PRICE_PER_MIB_RAW`: the SAME value the agent uses (CF-R2). */
  pricePerMibRaw: bigint;
  meterReadingId: string;
  observedAt: Date;
};

/**
 * Builds the M1 for a reading. `cumulativeAmount` comes from the SAME pure
 * function the agent uses for its cross-check (`computeExpectedAmountRaw`,
 * AC-R2 / S1-R5): the gateway is the authority on the amount, but if the
 * price or the formula differ the agent answers `amount_rejected`.
 */
export function buildMessage1(input: MeterReadingInput): Message1 {
  return {
    version: 1,
    sessionId: input.sessionId,
    channel: input.channel,
    network: input.network,
    asset: "USDC",
    cumulativeBytes: input.cumulativeBytes,
    cumulativeAmount: computeExpectedAmountRaw(BigInt(input.cumulativeBytes), input.pricePerMibRaw).toString(),
    meterReadingId: input.meterReadingId,
    observedAt: input.observedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Real HTTP client
// ---------------------------------------------------------------------------

/** Cap per HTTP request. Lower than the total deadline so that at least a
 * couple of attempts fit inside `METER_REPORT_INTERVAL_MS`. */
export const VOUCHER_REQUEST_TIMEOUT_MS_DEFAULT = 4_000;

export type HttpVoucherPortOptions = {
  /** Full URL of the endpoint, e.g. `http://127.0.0.1:8081/vouchers`. */
  url: string;
  /** The same secret the agent reads from `GATEWAY_TOKEN` (VE-R1). */
  gatewayToken: string;
  /** Injectable for tests. @default globalThis.fetch */
  fetch?: typeof fetch;
  /** @default VOUCHER_REQUEST_TIMEOUT_MS_DEFAULT */
  requestTimeoutMs?: number;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeErrorBody(body: unknown): string {
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return "no detail";
}

/**
 * A single attempt against `POST /vouchers`. Response mapping (FT-R5: the
 * HTTP status only says "may I ask again?"):
 * - `200` / `503` with a valid M2 body → the M2 is returned as is
 *   (signed, or unsigned with its explicit `retryable`, FT-R1).
 * - `401` (token) / `400` (schema) → `VoucherTransportError`, NOT retryable:
 *   it is configuration or a bug, and a retry would give the same result.
 * - another `5xx`, or `503` without M2 (proxy) → retryable.
 * - another `4xx`, or `200` without a valid M2 → NOT retryable (broken contract).
 * - network error / timeout → retryable.
 */
export function createHttpVoucherPort(options: HttpVoucherPortOptions): VoucherPort {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const requestTimeoutMs = options.requestTimeoutMs ?? VOUCHER_REQUEST_TIMEOUT_MS_DEFAULT;

  return {
    async requestVoucher(m1) {
      // The M1 is validated here with the shared schema: an invalid M1 is a
      // meter bug, better caught without spending a round trip (and without
      // retrying a certain 400).
      const parsedM1 = message1Schema.safeParse(m1);
      if (!parsedM1.success) {
        throw new VoucherTransportError(`invalid M1: ${parsedM1.error.message}`, { retryable: false });
      }

      let response: Response;
      try {
        response = await fetchImpl(options.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-gateway-token": options.gatewayToken,
          },
          body: JSON.stringify(parsedM1.data),
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
      } catch (error) {
        throw new VoucherTransportError(`POST /vouchers failed in transport: ${messageOf(error)}`, {
          retryable: true,
        });
      }

      const status = response.status;
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }

      if (status === 200 || status === 503) {
        const parsedM2 = message2Schema.safeParse(body);
        if (parsedM2.success) return parsedM2.data;
        throw new VoucherTransportError(`HTTP response ${status} is not a valid M2`, {
          retryable: status === 503,
          httpStatus: status,
        });
      }

      if (status === 401) {
        throw new VoucherTransportError(`agent rejected the token (401): check GATEWAY_TOKEN — ${describeErrorBody(body)}`, {
          retryable: false,
          httpStatus: status,
        });
      }
      if (status === 400) {
        throw new VoucherTransportError(`agent rejected the M1 (400): ${describeErrorBody(body)}`, {
          retryable: false,
          httpStatus: status,
        });
      }
      throw new VoucherTransportError(`unexpected HTTP response ${status} from POST /vouchers`, {
        retryable: status >= 500,
        httpStatus: status,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Bounded retries
// ---------------------------------------------------------------------------

/** FT-R3: the total time (attempts + waits) must stay below
 * `METER_REPORT_INTERVAL_MS` (10s by default in the agent). */
export const VOUCHER_RETRY_DEADLINE_MS_DEFAULT = 10_000;

export type VoucherRetryOptions = Omit<RetryOptions, "isRetryable">;

/** Carries a `retryable: true` M2 through `withRetry` (which only retries
 * on a throw). Internal to this module. */
class RetryableEnvelope extends Error {
  readonly envelope: Message2;

  constructor(envelope: Message2) {
    super(envelope.status === "unsigned" ? `${envelope.reason}: ${envelope.detail}` : "retryable");
    this.name = "RetryableEnvelope";
    this.envelope = envelope;
  }
}

function isRetryableVoucherError(error: unknown): boolean {
  return (
    error instanceof RetryableEnvelope ||
    error instanceof TimeoutError ||
    (error instanceof VoucherTransportError && error.retryable)
  );
}

/**
 * Wraps any `VoucherPort` with `withRetry` (exponential backoff with
 * jitter, `shared/retry.ts`). It retries ONLY:
 * - an unsigned M2 with `retryable: true` (`signer_unavailable`,
 *   `upstream_unavailable`, `internal_error`);
 * - a retryable `VoucherTransportError` or a `TimeoutError`.
 *
 * It never retries a signed M2 or a `retryable: false` (FT-R1: the gateway
 * branch is `if (!retryable) cut(); else backoff();`). If the attempts run
 * out on a retryable M2, it returns that last M2 (the caller sees the real
 * `reason`, also when the deadline cut it short); if they run out on a
 * transport failure, it rethrows.
 */
export function withVoucherRetry(port: VoucherPort, options: VoucherRetryOptions = {}): VoucherPort {
  return {
    async requestVoucher(m1) {
      let lastRetryable: Message2 | undefined;
      try {
        return await withRetry(
          async () => {
            const envelope = await port.requestVoucher(m1);
            if (envelope.status === "unsigned" && envelope.retryable) {
              lastRetryable = envelope;
              throw new RetryableEnvelope(envelope);
            }
            return envelope;
          },
          {
            deadlineMs: VOUCHER_RETRY_DEADLINE_MS_DEFAULT,
            ...options,
            isRetryable: isRetryableVoucherError,
          },
        );
      } catch (error) {
        if (error instanceof RetryableEnvelope) return error.envelope;
        // The deadline cut in before another attempt: the last retryable M2
        // seen describes the situation better than the deadline error.
        if (error instanceof RetryDeadlineExceededError && lastRetryable !== undefined) return lastRetryable;
        throw error;
      }
    },
  };
}

/** Default composition for production: real HTTP + retries. */
export function createAgentVoucherPort(
  options: HttpVoucherPortOptions & { retry?: VoucherRetryOptions },
): VoucherPort {
  return withVoucherRetry(createHttpVoucherPort(options), options.retry);
}

// ---------------------------------------------------------------------------
// Offline double (demo / tests)
// ---------------------------------------------------------------------------

export type InMemoryVoucherPortOptions = {
  /** Channel deposit in raw units (1e-7 USDC). A function is read on every
   * request, so a channel top-up shows without recreating the double. */
  depositRaw: bigint | (() => bigint);
  /** Label for the deterministic fake signature. NOT a secret. */
  seed?: string;
  now?: () => Date;
};

/**
 * Mimics the business rules of `agent/routes/vouchers.ts` with no network
 * or disk: equal to the highest signed → `reused: true`; lower →
 * `stale_reading`; above the deposit → `channel_exhausted`; higher → a new
 * voucher. The signature is a deterministic hash (like ed25519, RFC 8032),
 * NEVER a real signature. The envelopes are built and validated with the
 * shared schemas, so the double cannot emit something the real agent would
 * not emit.
 *
 * It does not recompute guardrails (AC-R2/AC-R7): the agent's tests cover that.
 */
export function createInMemoryVoucherPort(options: InMemoryVoucherPortOptions): VoucherPort {
  const seed = options.seed ?? "meter-demo-fake-voucher";
  const now = options.now ?? (() => new Date());
  const commitmentPubkey = createHash("sha256").update(`${seed}:commitment-pubkey`).digest("hex");
  const { depositRaw } = options;
  const deposit = typeof depositRaw === "function" ? depositRaw : () => depositRaw;
  let highest: { amountRaw: bigint; signature: string; signedAt: string } | undefined;

  function signed(m1: Message1, channel: string, reused: boolean): Message2 {
    return message2SignedSchema.parse({
      version: 1,
      status: "signed",
      sessionId: m1.sessionId,
      channel,
      voucher: {
        cumulativeAmount: highest!.amountRaw.toString(),
        signature: highest!.signature,
        commitmentPubkey,
        network: m1.network,
      },
      meterReadingId: m1.meterReadingId,
      reused,
      remaining: clampMin0(deposit() - highest!.amountRaw).toString(),
      signedAt: highest!.signedAt,
    });
  }

  return {
    async requestVoucher(m1) {
      const channel = m1.channel;
      if (channel === undefined) {
        throw new VoucherTransportError("channel is required in POST /vouchers (VE-R5)", {
          retryable: false,
          httpStatus: 400,
        });
      }
      const amountRaw = BigInt(m1.cumulativeAmount);
      const previousRaw = highest?.amountRaw ?? 0n;

      if (highest !== undefined && amountRaw === highest.amountRaw) {
        return signed(m1, channel, true);
      }
      if (highest !== undefined && amountRaw < highest.amountRaw) {
        return buildUnsigned("stale_reading", {
          sessionId: m1.sessionId,
          channel,
          remaining: clampMin0(deposit() - previousRaw).toString(),
          meterReadingId: m1.meterReadingId,
          detail: `cumulativeAmount ${amountRaw} is lower than the highest signed amount ${highest.amountRaw}`,
        }).body;
      }
      if (amountRaw > deposit()) {
        return buildUnsigned("channel_exhausted", {
          sessionId: m1.sessionId,
          channel,
          remaining: clampMin0(deposit() - previousRaw).toString(),
          meterReadingId: m1.meterReadingId,
          detail: `requested cumulative ${amountRaw} exceeds channel deposit ${deposit()}`,
        }).body;
      }

      const signature = createHash("sha512").update(`${seed}:${m1.network}:${channel}:${amountRaw}`).digest("hex");
      highest = { amountRaw, signature, signedAt: now().toISOString() };
      return signed(m1, channel, false);
    },
  };
}

function clampMin0(value: bigint): bigint {
  return value < 0n ? 0n : value;
}
