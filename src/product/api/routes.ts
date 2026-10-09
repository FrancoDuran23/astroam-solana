import { Router, type Request, type Response, type NextFunction } from 'express'
import type { MissionProductService } from '../services/MissionProductService.ts'
import {
  createMissionSchema,
  paymentConfirmationSchema,
  closeConfirmationSchema,
  topupIntentSchema,
  topupConfirmationSchema,
  demoTrafficSchema,
  voucherSchema,
  settleSchema,
} from '../schemas/mission.ts'

function getId(req: Request): string {
  const raw = req.params.id
  return Array.isArray(raw) ? raw[0] : raw
}

/**
 * CORS for the traveler app when it is served from another origin (Vercel,
 * Netlify). The app sends its requests with credentials, and a browser drops
 * the response to such a request unless the server allows credentials for
 * that exact origin. A wildcard origin cannot do that, so the header is only
 * sent when FRONTEND_ORIGIN names one.
 */
export function cors(req: Request, res: Response, next: NextFunction): void {
  const origin = process.env.FRONTEND_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  if (origin !== '*') {
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
}

export function createProductRouter(service: MissionProductService): Router {
  const router = Router()

  router.use(cors)

  // Auth & Live Guard Middleware for mutable endpoints when live mode is active
  const requireAuthIfNeeded = (req: Request, res: Response, next: NextFunction) => {
    if (process.env.ASTROAM_LIVE_ENABLED === 'true') {
      const origin = process.env.FRONTEND_ORIGIN
      if (!origin || origin === '*') {
        res.status(503).json({
          error: 'service_unavailable',
          message: "FRONTEND_ORIGIN with '*' is not allowed in live mode",
        })
        return
      }

      if (!process.env.ASTROAM_DEMO_ACCESS_TOKEN) {
        res.status(503).json({
          error: 'service_unavailable',
          message: 'ASTROAM_DEMO_ACCESS_TOKEN must be set on the server for mutating operations in live mode',
        })
        return
      }

      const auth = req.headers.authorization
      const expected = `Bearer ${process.env.ASTROAM_DEMO_ACCESS_TOKEN}`
      if (auth !== expected) {
        res.status(401).json({
          error: 'unauthorized',
          message: 'A valid access token is required for mutating operations in live mode',
        })
        return
      }
    }
    next()
  }

  // 1. Capabilities
  router.get('/capabilities', async (_req: Request, res: Response) => {
    try {
      const caps = await service.getCapabilities()
      res.json(caps)
    } catch (err) {
      res.status(500).json({ error: 'capabilities_failed', message: err instanceof Error ? err.message : String(err) })
    }
  })

  // 2. Create Mission
  router.post('/missions', requireAuthIfNeeded, async (req: Request, res: Response) => {
    try {
      const parsed = createMissionSchema.parse(req.body)
      const result = await service.createMission(parsed)
      res.status(201).json(result)
    } catch (err) {
      res.status(400).json({ error: 'invalid_request', message: err instanceof Error ? err.message : String(err) })
    }
  })

  // 3. Payment Intent
  router.post('/missions/:id/payment-intent', requireAuthIfNeeded, async (req: Request, res: Response) => {
    try {
      const result = await service.createPaymentIntent(getId(req))
      res.json(result)
    } catch (err) {
      const is503 = err instanceof Error && err.message.includes('503:')
      res.status(is503 ? 503 : 400).json({ error: 'payment_intent_error', message: err instanceof Error ? err.message : String(err) })
    }
  })

  // 4. Payment Confirmation
  router.post('/missions/:id/payment-confirmation', requireAuthIfNeeded, async (req: Request, res: Response) => {
    try {
      const parsed = paymentConfirmationSchema.parse(req.body)
      const result = await service.confirmPayment(getId(req), parsed.intentId, parsed.txHash, parsed.traveler, parsed.sessionKey)
      res.json(result)
    } catch (err) {
      const is503 = err instanceof Error && err.message.includes('503:')
      res.status(is503 ? 503 : 400).json({ error: 'payment_confirmation_failed', message: err instanceof Error ? err.message : String(err) })
    }
  })

  // 5. Activate Mission
  router.post('/missions/:id/activate', requireAuthIfNeeded, async (req: Request, res: Response) => {
    try {
      const result = await service.activateMission(getId(req))
      res.json(result)
    } catch (err) {
      const is503 = err instanceof Error && err.message.includes('503:')
      res.status(is503 ? 503 : 400).json({ error: 'activation_failed', message: err instanceof Error ? err.message : String(err) })
    }
  })

  // 6. Get Mission Status
  router.get('/missions/:id', async (req: Request, res: Response) => {
    try {
      const result = await service.getMission(getId(req))
      res.json(result)
    } catch (err) {
      res.status(404).json({ error: 'not_found', message: err instanceof Error ? err.message : String(err) })
    }
  })

  // 7. Get Mission Usage
  router.get('/missions/:id/usage', async (req: Request, res: Response) => {
    try {
      const result = await service.getUsage(getId(req))
      res.json(result)
    } catch (err) {
      res.status(404).json({ error: 'not_found', message: err instanceof Error ? err.message : String(err) })
    }
  })

  // 7b. Mission log: the eSIM's provisioning and every usage reading, in order
  router.get('/missions/:id/logs', async (req: Request, res: Response) => {
    try {
      const entries = await service.getMissionLog(getId(req))
      res.json({ missionId: getId(req), entries })
    } catch (err) {
      res.status(404).json({ error: 'not_found', message: err instanceof Error ? err.message : String(err) })
    }
  })

  // 8. Pause Mission
  router.post('/missions/:id/pause', requireAuthIfNeeded, async (req: Request, res: Response) => {
    try {
      const result = await service.pauseMission(getId(req))
      res.json(result)
    } catch (err) {
      const is503 = err instanceof Error && err.message.includes('503:')
      res.status(is503 ? 503 : 400).json({ error: 'pause_failed', message: err instanceof Error ? err.message : String(err) })
    }
  })

  // 9. Resume Mission
  router.post('/missions/:id/resume', requireAuthIfNeeded, async (req: Request, res: Response) => {
    try {
      const result = await service.resumeMission(getId(req))
      res.json(result)
    } catch (err) {
      const is503 = err instanceof Error && err.message.includes('503:')
      res.status(is503 ? 503 : 400).json({ error: 'resume_failed', message: err instanceof Error ? err.message : String(err) })
    }
  })

  // 10. TopUp Payment Intent & Confirmation
  router.post('/missions/:id/topups/payment-intent', requireAuthIfNeeded, async (req: Request, res: Response) => {
    try {
      const parsed = topupIntentSchema.parse(req.body)
      const result = await service.createTopUpIntent(getId(req), parsed.amountUsdc)
      res.json(result)
    } catch (err) {
      const is503 = err instanceof Error && err.message.includes('503:')
      res.status(is503 ? 503 : 400).json({ error: 'topup_intent_error', message: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/missions/:id/topups/payment-confirmation', requireAuthIfNeeded, async (req: Request, res: Response) => {
    try {
      const parsed = topupConfirmationSchema.parse(req.body)
      const result = await service.confirmTopUpPayment(getId(req), parsed.intentId, parsed.txHash)
      res.json(result)
    } catch (err) {
      const is503 = err instanceof Error && err.message.includes('503:')
      res.status(is503 ? 503 : 400).json({ error: 'topup_confirmation_failed', message: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/missions/:id/cancel', requireAuthIfNeeded, async (req: Request, res: Response) => {
    try {
      const result = await service.cancelMission(getId(req))
      res.json(result)
    } catch (err) {
      const is503 = err instanceof Error && err.message.includes('503:')
      res.status(is503 ? 503 : 400).json({ error: 'cancel_failed', message: err instanceof Error ? err.message : String(err) })
    }
  })

  // 11. Finish Mission — quotes the cumulative voucher. The wallet sends the close.
  router.post('/missions/:id/finish', requireAuthIfNeeded, async (req: Request, res: Response) => {
    try {
      const result = await service.finishMission(getId(req))
      res.json(result)
    } catch (err) {
      const is503 = err instanceof Error && err.message.includes('503:')
      res.status(is503 ? 503 : 400).json({ error: 'finish_failed', message: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/missions/:id/close', requireAuthIfNeeded, async (req: Request, res: Response) => {
    try {
      const parsed = closeConfirmationSchema.parse(req.body)
      const result = await service.confirmClose(getId(req), parsed.txHash, parsed.settlement)
      res.json(result)
    } catch (err) {
      const is503 = err instanceof Error && err.message.includes('503:')
      res.status(is503 ? 503 : 400).json({ error: 'close_failed', message: err instanceof Error ? err.message : String(err) })
    }
  })

  // Vouchers: what the app signs next, and the app handing one over.
  router.get('/missions/:id/voucher-request', async (req: Request, res: Response) => {
    try {
      res.json(await service.voucherRequest(getId(req)))
    } catch (err) {
      res.status(404).json({ error: 'not_found', message: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/missions/:id/vouchers', requireAuthIfNeeded, async (req: Request, res: Response) => {
    try {
      const parsed = voucherSchema.parse(req.body)
      res.json(await service.submitVoucher(getId(req), parsed))
    } catch (err) {
      res.status(400).json({ error: 'voucher_rejected', message: err instanceof Error ? err.message : String(err) })
    }
  })

  // The meter signs the current usage and checkpoints it. The traveler does not.
  router.post('/missions/:id/attest', requireAuthIfNeeded, async (req: Request, res: Response) => {
    try {
      res.json(await service.attestMission(getId(req)))
    } catch (err) {
      res.status(400).json({ error: 'attest_failed', message: err instanceof Error ? err.message : String(err) })
    }
  })

  // Settle: the backend sends the close with a meter-signed voucher. No wallet popup.
  router.post('/missions/:id/settle', requireAuthIfNeeded, async (req: Request, res: Response) => {
    try {
      const parsed = settleSchema.parse(req.body)
      res.json(await service.settleMission(getId(req), parsed.voucher))
    } catch (err) {
      const is503 = err instanceof Error && err.message.includes('503:')
      res.status(is503 ? 503 : 400).json({ error: 'settle_failed', message: err instanceof Error ? err.message : String(err) })
    }
  })

  // 12. Demo Traffic Injection (only if ENABLE_DEMO_TRAFFIC=true)
  router.post('/missions/:id/demo-traffic', requireAuthIfNeeded, async (req: Request, res: Response) => {
    if (process.env.ENABLE_DEMO_TRAFFIC !== 'true') {
      res.status(403).json({ error: 'forbidden', message: 'Demo traffic injection is not enabled' })
      return
    }
    try {
      const parsed = demoTrafficSchema.parse(req.body)
      const result = await service.processDemoTraffic(getId(req), parsed.bytes)
      res.json(result)
    } catch (err) {
      const is503 = err instanceof Error && err.message.includes('503:')
      res.status(is503 ? 503 : 400).json({ error: 'demo_traffic_failed', message: err instanceof Error ? err.message : String(err) })
    }
  })

  return router
}
