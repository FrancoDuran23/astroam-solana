/**
 * Integrates the meter with the cut-off policy and the state of the payment channel.
 *
 * It joins:
 * - NetworkDataMeter (real-time traffic meter; today, the local accounting)
 * - VoucherPort (POST /vouchers on the MPP payments agent, src/meter/voucher-port.ts)
 * - PolicyEnforcer (decision rules and cut-offs on the eSIM, docs/citrus-mobile-spec.md v2 §7 R8)
 * - ChannelBalancePort (the channel deposit, provided by the chain's payment rail)
 *
 * Central rule: the meter's quota is credited ONLY with a signed voucher
 * (`status: "signed"`, new or `reused`) that covers the measured total. A
 * non-retryable rejection (`channel_exhausted`, `channel_closing`, ...)
 * credits nothing: the meter cuts only once the unpaid quota is exceeded,
 * and the policy decides the channel's data cut-off (`suspend` the eSIM).
 *
 * Two entry points:
 * - `processTraffic(bytesTransferred)`: records a real burst in the meter and
 *   processes the new total (legacy step / demos; the agent bills bytes).
 * - `processCumulative(cumulativeBytes)`: processes an EXTERNAL total (the
 *   "equivalent bytes" of spec §6.2 that the usage loop derives from the
 *   usage Citrus charged). It records no local traffic: the number IS
 *   already the total the voucher is requested for.
 */

import { NetworkDataMeter, type MeterConfig } from "./demo-meter.ts";
import {
  decidePolicy,
  computeCostRaw,
  type ChannelBalancePort,
  type EnforcementAction,
} from "../services/PolicyEnforcer.ts";
import type { ConnectivityProvider } from "../providers/connectivity/ConnectivityProvider.ts";
import type { ConnectivitySession } from "../models/ConnectivitySession.ts";
import type { Message2Signed, Message2Unsigned } from "../shared/messages.ts";
import { arePricesAligned, pricePerMibFromPerMbRaw } from "../shared/money.ts";
import type { Network } from "../shared/network.ts";
import { buildMessage1, type VoucherPort } from "./voucher-port.ts";

export interface MeterServiceOptions {
  session: ConnectivitySession;
  provider: ConnectivityProvider;
  balancePort: ChannelBalancePort;
  /** POST /vouchers on the agent: without a signed voucher no quota is credited. */
  voucherPort: VoucherPort;
  /** Channel network (`<chain>:<name>`, e.g. "monad:testnet"); it travels in the M1. */
  network: Network;
  /**
   * The agent's `PRICE_PER_MIB_RAW` (raw units per MiB = 1_048_576 bytes).
   * It is the VOUCHER price and must be identical to the agent's (CF-R2), or
   * the agent answers `amount_rejected`. Different from `pricePerMbRaw`,
   * which is the policy's price per decimal MB (PRICE_PER_MB_RAW); both must
   * be the same rate (`arePricesAligned`) or the constructor throws.
   */
  voucherPricePerMibRaw: bigint;
  meterConfig?: Partial<MeterConfig>;
  pricePerMbRaw: bigint;
  logger?: (msg: string) => void;
  /** Injectable clock for `observedAt` in tests. */
  now?: () => Date;
}

/** Result of the voucher request for one reading. */
export type VoucherRequestResult =
  /** Signed voucher (new or `reused`) that covers the requested total. */
  | { kind: "signed"; envelope: Message2Signed }
  /** The agent answered but did not sign (explicit `reason` + `retryable`). */
  | { kind: "unsigned"; envelope: Message2Unsigned }
  /** No usable business response (network, 401/400, broken contract). */
  | { kind: "unavailable"; detail: string };

type MeterRunResult = {
  meterStatus: ReturnType<NetworkDataMeter["getStatus"]>;
  actionApplied: EnforcementAction;
  voucher: VoucherRequestResult;
};

export class IntegratedMeterService {
  private meter: NetworkDataMeter;
  private session: ConnectivitySession;
  private provider: ConnectivityProvider;
  private balancePort: ChannelBalancePort;
  private voucherPort: VoucherPort;
  private network: Network;
  private voucherPricePerMibRaw: bigint;
  private pricePerMbRaw: bigint;
  private logger: (msg: string) => void;
  private now: () => Date;
  private readingSeq = 0;

  constructor(opts: MeterServiceOptions) {
    // The agent (per MiB) and the policy (per MB) must charge the same rate,
    // or they disagree on when the channel runs out.
    if (!arePricesAligned(opts.pricePerMbRaw, opts.voucherPricePerMibRaw)) {
      throw new RangeError(
        `IntegratedMeterService: misaligned prices — pricePerMbRaw=${opts.pricePerMbRaw} (policy, per MB) ` +
          `and voucherPricePerMibRaw=${opts.voucherPricePerMibRaw} (agent, per MiB) are not the same rate; ` +
          `expected voucherPricePerMibRaw=${pricePerMibFromPerMbRaw(opts.pricePerMbRaw)}`,
      );
    }
    this.session = opts.session;
    this.provider = opts.provider;
    this.balancePort = opts.balancePort;
    this.voucherPort = opts.voucherPort;
    this.network = opts.network;
    this.voucherPricePerMibRaw = opts.voucherPricePerMibRaw;
    this.pricePerMbRaw = opts.pricePerMbRaw;
    this.logger = opts.logger ?? console.log;
    this.now = opts.now ?? (() => new Date());
    this.meter = new NetworkDataMeter(opts.meterConfig);
  }

  /**
   * Asks the agent for the cumulative voucher that covers `cumulativeBytes`.
   * It never throws: any transport failure (already retried by the port, see
   * `withVoucherRetry`) is returned as `unavailable`.
   */
  private async requestVoucher(cumulativeBytes: number): Promise<VoucherRequestResult> {
    this.readingSeq += 1;
    const m1 = buildMessage1({
      sessionId: this.session.id,
      channel: this.session.channelId,
      network: this.network,
      cumulativeBytes,
      pricePerMibRaw: this.voucherPricePerMibRaw,
      meterReadingId: `mr_${this.session.id}_${this.readingSeq}`,
      observedAt: this.now(),
    });

    let envelope;
    try {
      envelope = await this.voucherPort.requestVoucher(m1);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger(`⚠️ [VOUCHER] Payments agent unavailable: ${detail}. No quota credited.`);
      return { kind: "unavailable", detail };
    }

    if (envelope.status === "unsigned") {
      if (envelope.retryable) {
        this.logger(
          `⏳ [VOUCHER] Agent answered ${envelope.reason} (retryable): ${envelope.detail}. No quota credited; it is requested again on the next reading.`,
        );
      } else {
        this.logger(
          `⛔ [VOUCHER] Agent rejected the voucher: ${envelope.reason} (not retryable, remaining=${envelope.remaining} raw). No quota credited.`,
        );
      }
      return { kind: "unsigned", envelope };
    }

    // Defense: a cumulative voucher for an amount LOWER than requested does
    // not cover the reading (the agent should never return it: idempotency
    // and coalescing always return an amount >= the requested one).
    if (BigInt(envelope.voucher.cumulativeAmount) < BigInt(m1.cumulativeAmount)) {
      const detail = `voucher for ${envelope.voucher.cumulativeAmount} raw does not cover the requested total ${m1.cumulativeAmount} raw`;
      this.logger(`⚠️ [VOUCHER] ${detail}. No quota credited.`);
      return { kind: "unavailable", detail };
    }

    this.logger(
      `🧾 [VOUCHER] Voucher ${envelope.reused ? "reused" : "signed"} for ${envelope.voucher.cumulativeAmount} raw (remaining=${envelope.remaining} raw).`,
    );
    return { kind: "signed", envelope };
  }

  /**
   * Processes an external TOTAL (equivalent bytes of spec §6.2, the base the
   * usage loop requests, and the final voucher of the close, R9): requests
   * the voucher, evaluates the policy against the channel deposit and
   * suspends the eSIM if the channel ran out. It records no traffic:
   * `cumulativeBytes` IS already the total.
   */
  public async processCumulative(cumulativeBytes: number): Promise<MeterRunResult> {
    const voucher = await this.requestVoucher(cumulativeBytes);
    const balanceRaw = await this.balancePort.getChannelBalance(this.session.channelId);
    const costRaw = computeCostRaw(BigInt(cumulativeBytes), this.pricePerMbRaw);
    const action = decidePolicy({ balanceRaw, costRaw, pricePerMbRaw: this.pricePerMbRaw });

    if (action.kind === "suspend") {
      this.logger(`🚨 [POLICY ENFORCER] Suspending eSIM (channel exhausted): ${action.reason}`);
      await this.provider.suspend(this.session.iccid);
    } else {
      this.logger(`✅ [POLICY ENFORCER] Usage within the channel balance. No suspension.`);
    }

    if (action.kind === "noop" && voucher.kind === "signed") {
      this.meter.creditPaidQuota(cumulativeBytes);
    }

    return { meterStatus: this.meter.getStatus(), actionApplied: action, voucher };
  }

  /**
   * Records a traffic burst in the meter, requests the cumulative voucher
   * from the payments agent and runs the policy evaluation against the
   * payment channel deposit and the eSIM. The meter's quota is credited only
   * if the agent signed (or reused) a voucher that covers it.
   */
  public async processTraffic(bytesTransferred: number): Promise<MeterRunResult> {
    // 1. Record traffic in the local meter
    const { cumulativeBytes } = this.meter.recordTraffic(bytesTransferred);

    // 2. Request the cumulative voucher that covers the measured usage (POST /vouchers)
    const voucher = await this.requestVoucher(cumulativeBytes);

    // 3. Read the payment channel deposit and evaluate the policy
    const balanceRaw = await this.balancePort.getChannelBalance(this.session.channelId);
    const costRaw = computeCostRaw(BigInt(cumulativeBytes), this.pricePerMbRaw);
    const action = decidePolicy({ balanceRaw, costRaw, pricePerMbRaw: this.pricePerMbRaw });

    // 4. Apply the side effects on the eSIM if needed and sync the quota
    if (action.kind === "suspend") {
      this.logger(`🚨 [POLICY ENFORCER] Suspending eSIM (channel exhausted): ${action.reason}`);
      await this.provider.suspend(this.session.iccid);
    } else {
      this.logger(`✅ [POLICY ENFORCER] Traffic within the balance. No change to the eSIM.`);
    }
    if (action.kind === "noop" && voucher.kind === "signed") {
      this.meter.creditPaidQuota(cumulativeBytes);
    }

    return { meterStatus: this.meter.getStatus(), actionApplied: action, voucher };
  }

  public getMeter(): NetworkDataMeter {
    return this.meter;
  }
}