/**
 * Module 1: Meter and Connectivity (demo / first prototype)
 *
 * This script simulates capturing and counting bytes of network traffic (layer 3 / VPN).
 * The request for cumulative vouchers against the MPP payments agent is made by
 * `IntegratedMeterService` (meter-service.ts) through `VoucherPort`
 * (voucher-port.ts): `creditPaidQuota` is only called there, with a signed voucher.
 */

export interface MeterConfig {
  /** Size of each batch/block of data in bytes (e.g. 1 MB = 1,000,000 bytes) */
  chunkSizeBytes: number;
  /** Maximum quota allowed without a new valid voucher */
  maxUnpaidQuotaBytes: number;
}

/** Formats bytes as readable text in megabytes (MB) */
export function formatMb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

export class NetworkDataMeter {
  private cumulativeBytes: number = 0;
  private paidQuotaBytes: number = 0;
  private isConnectionActive: boolean = true;
  private config: MeterConfig;

  constructor(config?: Partial<MeterConfig>) {
    this.config = {
      chunkSizeBytes: config?.chunkSizeBytes ?? 1_000_000, // 1 MB by default
      maxUnpaidQuotaBytes: config?.maxUnpaidQuotaBytes ?? 1_000_000,
    };
  }

  /**
   * Simulates data packets arriving/leaving through the tunnel (WireGuard / proxy)
   * @param bytesTransferred Number of bytes used in this network burst
   */
  public recordTraffic(bytesTransferred: number): {
    cumulativeBytes: number;
    isQuotaAvailable: boolean;
  } {
    if (!this.isConnectionActive) {
      console.warn('⚠️ [METER] Traffic is CUT. No more data can be processed.');
      return { cumulativeBytes: this.cumulativeBytes, isQuotaAvailable: false };
    }

    this.cumulativeBytes += bytesTransferred;
    console.log(
      `📊 [METER] Traffic recorded: +${formatMb(bytesTransferred)} (+${bytesTransferred} bytes) | Running total: ${formatMb(this.cumulativeBytes)}`
    );

    // Check whether usage exceeds the paid quota
    if (this.cumulativeBytes > this.paidQuotaBytes + this.config.maxUnpaidQuotaBytes) {
      console.error(
        `🚨 [CUT-OFF ALERT] Usage (${formatMb(this.cumulativeBytes)}) exceeded the paid quota (${formatMb(this.paidQuotaBytes)}). Cutting traffic...`
      );
      this.isConnectionActive = false;
    }

    return {
      cumulativeBytes: this.cumulativeBytes,
      isQuotaAvailable: this.isConnectionActive,
    };
  }

  /**
   * Credits a new successful payment by raising the available data quota, and reactivates traffic
   */
  public creditPaidQuota(newPaidCumulativeBytes: number): void {
    if (newPaidCumulativeBytes >= this.cumulativeBytes) {
      this.paidQuotaBytes = newPaidCumulativeBytes;
      this.isConnectionActive = true;
      console.log(
        `✅ [CREDIT] New voucher verified. Paid quota updated to: ${formatMb(this.paidQuotaBytes)}. Connectivity RESTORED.`
      );
    } else {
      console.warn(
        `⚠️ [CREDIT REJECTED] The voucher presented (${formatMb(newPaidCumulativeBytes)}) is lower than the cumulative usage (${formatMb(this.cumulativeBytes)}).`
      );
    }
  }

  public getStatus() {
    return {
      cumulativeBytes: this.cumulativeBytes,
      cumulativeMb: formatMb(this.cumulativeBytes),
      paidQuotaBytes: this.paidQuotaBytes,
      paidQuotaMb: formatMb(this.paidQuotaBytes),
      isConnectionActive: this.isConnectionActive,
    };
  }
}

// Quick runnable example when executed directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.includes('demo-meter.ts')) {
  console.log('🚀 === Starting the Traffic Meter test (Module 1) ===\n');
  const meter = new NetworkDataMeter({ chunkSizeBytes: 500_000, maxUnpaidQuotaBytes: 1_000_000 });

  // 1. Simulate traffic within the quota range
  meter.recordTraffic(500_000);
  meter.recordTraffic(400_000);

  // 2. Simulate a voucher payment for 1,500,000 bytes (1.5 MB)
  meter.creditPaidQuota(1_500_000);

  // 3. Simulate more traffic
  meter.recordTraffic(700_000);
  
  // 4. Try to go past the paid quota to check the automatic cut-off
  meter.recordTraffic(1_000_000);
  meter.recordTraffic(500_000);

  console.log('\n📌 Final meter state:', meter.getStatus());
}
