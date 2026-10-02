import { createConnectivityProvider } from '../../providers/connectivity/createConnectivityProvider.ts'
import { FakeProvider } from '../../providers/connectivity/FakeProvider.ts'
import type { ConnectivityProvider } from '../../providers/connectivity/ConnectivityProvider.ts'
import { createPaymentRail } from '../../rails/createPaymentRail.ts'
import type { PaymentRail } from '../../rails/PaymentRail.ts'
import { FileMissionRepository } from '../persistence/MissionRepository.ts'
import { MissionProductService } from '../services/MissionProductService.ts'

export function bootProductService(
  env: Record<string, string | undefined> = process.env,
  rail: PaymentRail = createPaymentRail(env),
): MissionProductService {
  const repo = new FileMissionRepository(env.DATA_DIR)

  let connectivity: ConnectivityProvider = new FakeProvider()
  let hasCitrusReal = false
  if (env.CONNECTIVITY_PROVIDER === 'citrus' && env.CITRUS_API_KEY) {
    try {
      const bundle = createConnectivityProvider({
        CONNECTIVITY_PROVIDER: 'citrus',
        CITRUS_API_KEY: env.CITRUS_API_KEY,
        CITRUS_BASE_URL: env.CITRUS_BASE_URL,
        PRICE_PER_MB_RAW: BigInt(env.PRICE_PER_MB_RAW || 25000),
        NETWORK: rail.network,
        DATA_DIR: env.DATA_DIR || './data',
      })
      connectivity = bundle.provider
      hasCitrusReal = true
    } catch {
      connectivity = new FakeProvider()
    }
  }

  return new MissionProductService({ repo, connectivity, rail, hasCitrusReal })
}
