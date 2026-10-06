import { envConfig } from '../config/env'
import type {
  BackendCapabilities,
  CancelResult,
  FinishResult,
  Mission,
  PaymentConfirmationResult,
  PaymentIntentInfo,
  PublicEsimInfo,
  SignedVoucher,
  VoucherRequest,
  WizardData,
} from '../types/mission'

const MISSION_ID_KEY = 'astroam_mission_id'

function getAuthHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}: ${res.statusText}`
    try {
      const body = (await res.json()) as { message?: string; error?: string }
      message = body.message || body.error || message
    } catch {
      // Ignore json parse error
    }
    const err = new Error(message)
    ;(err as unknown as { statusCode: number }).statusCode = res.status
    throw err
  }
  return (await res.json()) as T
}

export class ApiMissionService {
  private get baseUrl(): string {
    return envConfig.apiBaseUrl
  }

  async fetchCapabilities(): Promise<BackendCapabilities | null> {
    try {
      const res = await fetch(`${this.baseUrl}/capabilities`, {
        credentials: 'include',
      })
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  }

  async createMission(data: WizardData): Promise<Mission> {
    if (!data.destination) throw new Error('No destination selected')

    const res = await fetch(`${this.baseUrl}/missions`, {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
      body: JSON.stringify({
        userId: 'usr_astroam',
        destination: data.destination,
        startDate: data.startDate,
        endDate: data.endDate,
        budgetUsdc: data.budgetUsdc,
        dailyLimitUsdc: data.dailyLimitUsdc,
        autoPause: data.autoPauseAtLimit,
        lowBalanceAlert: data.alertAt20pct,
      }),
    })

    const created = await handleResponse<{ id: string; status: string }>(res)
    localStorage.setItem(MISSION_ID_KEY, created.id)

    const mission: Mission = {
      id: created.id,
      origin: 'Argentina',
      destination: data.destination,
      startDate: data.startDate,
      endDate: data.endDate,
      durationDays: Math.max(1, Math.ceil((new Date(data.endDate).getTime() - new Date(data.startDate).getTime()) / (1000 * 3600 * 24))),
      budgetUsdc: data.budgetUsdc,
      dailyLimitUsdc: data.dailyLimitUsdc,
      alertAt20pct: data.alertAt20pct,
      autoPauseAtLimit: data.autoPauseAtLimit,
      status: 'pending_payment',
      paymentStatus: 'pending',
      balanceUsdc: data.budgetUsdc,
      consumedUsdc: 0,
      consumedMb: 0,
      esimStatus: 'not_provisioned',
      network: 'demo:local',
      channelId: '',
      createdAt: new Date().toISOString(),
    }

    return mission
  }

  async createPaymentIntent(missionId: string): Promise<PaymentIntentInfo> {
    const res = await fetch(`${this.baseUrl}/missions/${missionId}/payment-intent`, {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
    })
    return handleResponse<PaymentIntentInfo>(res)
  }

  async confirmPayment(
    missionId: string,
    intentId: string,
    txHash: string,
    traveler?: string,
    sessionKey?: string,
  ): Promise<PaymentConfirmationResult> {
    const res = await fetch(`${this.baseUrl}/missions/${missionId}/payment-confirmation`, {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
      body: JSON.stringify({ intentId, txHash, ...(traveler ? { traveler } : {}), ...(sessionKey ? { sessionKey } : {}) }),
    })
    return handleResponse<PaymentConfirmationResult>(res)
  }

  async activateMission(missionId: string): Promise<{ missionId: string; status: string; isMock?: boolean; esim?: PublicEsimInfo }> {
    const res = await fetch(`${this.baseUrl}/missions/${missionId}/activate`, {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
    })
    return handleResponse<{ missionId: string; status: string; isMock?: boolean; esim?: PublicEsimInfo }>(res)
  }

  async getMission(missionId: string): Promise<Mission> {
    const res = await fetch(`${this.baseUrl}/missions/${missionId}`, {
      credentials: 'include',
    })
    return handleResponse<Mission>(res)
  }

  async getUsage(missionId: string): Promise<{
    chargedMicroUsd: string
    tripChargedMicroUsd?: string
    walletMicroUsd: string
    providerStatus: string
    meteredBytes: string
    carrierBytes: string
    differenceBytes: string
    isEstimation: boolean
    note: string
  }> {
    const res = await fetch(`${this.baseUrl}/missions/${missionId}/usage`, {
      credentials: 'include',
    })
    return handleResponse(res)
  }

  async pauseMission(missionId: string): Promise<{ status: string; esimStatus: string }> {
    const res = await fetch(`${this.baseUrl}/missions/${missionId}/pause`, {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
    })
    return handleResponse<{ status: string; esimStatus: string }>(res)
  }

  async resumeMission(missionId: string): Promise<{ status: string; esimStatus: string }> {
    const res = await fetch(`${this.baseUrl}/missions/${missionId}/resume`, {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
    })
    return handleResponse<{ status: string; esimStatus: string }>(res)
  }

  async createTopUpIntent(missionId: string, amountUsdc: number): Promise<PaymentIntentInfo> {
    const res = await fetch(`${this.baseUrl}/missions/${missionId}/topups/payment-intent`, {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
      body: JSON.stringify({ amountUsdc }),
    })
    return handleResponse<PaymentIntentInfo>(res)
  }

  async confirmTopUpPayment(missionId: string, intentId: string, txHash: string): Promise<PaymentConfirmationResult & { balanceUsdc?: number }> {
    const res = await fetch(`${this.baseUrl}/missions/${missionId}/topups/payment-confirmation`, {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
      body: JSON.stringify({ intentId, txHash }),
    })
    return handleResponse<PaymentConfirmationResult & { balanceUsdc?: number }>(res)
  }

  async voucherRequest(missionId: string): Promise<VoucherRequest> {
    const res = await fetch(`${this.baseUrl}/missions/${missionId}/voucher-request`, { credentials: 'include' })
    return handleResponse<VoucherRequest>(res)
  }

  async submitVoucher(missionId: string, voucher: SignedVoucher): Promise<{ cumulativeAtomic: string; claimedAtomic: string }> {
    const res = await fetch(`${this.baseUrl}/missions/${missionId}/vouchers`, {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
      body: JSON.stringify(voucher),
    })
    return handleResponse(res)
  }

  /** The meter signs the current usage and checkpoints it on the escrow. */
  async attest(missionId: string): Promise<{ cumulativeAtomic: string; claimedAtomic: string }> {
    const res = await fetch(`${this.baseUrl}/missions/${missionId}/attest`, {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
      body: '{}',
    })
    return handleResponse(res)
  }

  /** The backend sends the close. A voucher is optional and must be meter-signed. */
  async settle(missionId: string, voucher?: SignedVoucher): Promise<FinishResult> {
    const res = await fetch(`${this.baseUrl}/missions/${missionId}/settle`, {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
      body: JSON.stringify(voucher ? { voucher } : {}),
    })
    return handleResponse<FinishResult>(res)
  }

  async confirmClose(missionId: string, txHash: string, settlement: 'close' | 'timeout_refund'): Promise<FinishResult> {
    const res = await fetch(`${this.baseUrl}/missions/${missionId}/close`, {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
      body: JSON.stringify({ txHash, settlement }),
    })
    return handleResponse<FinishResult>(res)
  }

  async finishMission(missionId: string): Promise<FinishResult> {
    const res = await fetch(`${this.baseUrl}/missions/${missionId}/finish`, {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
    })
    return handleResponse<FinishResult>(res)
  }

  async cancelMission(missionId: string): Promise<CancelResult> {
    const res = await fetch(`${this.baseUrl}/missions/${missionId}/cancel`, {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
    })
    return handleResponse<CancelResult>(res)
  }

  async triggerDemoTraffic(missionId: string, bytes = 500_000): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/missions/${missionId}/demo-traffic`, {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
      body: JSON.stringify({ bytes }),
    })
    return handleResponse(res)
  }

  getSavedMissionId(): string | null {
    return localStorage.getItem(MISSION_ID_KEY)
  }

  clearSavedMissionId(): void {
    localStorage.removeItem(MISSION_ID_KEY)
  }
}

export const apiMissionService = new ApiMissionService()
