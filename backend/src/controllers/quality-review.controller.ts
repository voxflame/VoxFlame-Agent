import { Router } from 'express'

import { qualityReviewerMiddleware } from '../middlewares/quality-reviewer.middleware'
import {
  qualityReviewService,
  type QualityReviewDecision,
} from '../services/quality-review.service'

const router = Router()
const DECISIONS = new Set<QualityReviewDecision>(['approved', 'rejected', 'needs_retake'])

router.use(qualityReviewerMiddleware)

router.get('/queue', async (req, res) => {
  try {
    const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50
    const limit = Number.isInteger(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 50
    res.json({ items: await qualityReviewService.listPending(limit) })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error'
    res.status(500).json({ error: message })
  }
})

router.post('/decisions', async (req, res) => {
  try {
    const contributorId = req.user?.id
    const reviewerEmail = req.user?.email ?? ''
    const contributionId = typeof req.body?.contributionId === 'string' ? req.body.contributionId.trim() : ''
    const decision = typeof req.body?.decision === 'string' ? req.body.decision.trim() : ''
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : ''
    const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : ''
    if (!contributorId || !contributionId || !reason || !requestId || !DECISIONS.has(decision as QualityReviewDecision)) {
      return res.status(400).json({ error: 'Invalid quality review decision' })
    }
    const result = await qualityReviewService.submitDecision({
      contributionId,
      reviewerId: contributorId,
      reviewerEmail,
      decision: decision as QualityReviewDecision,
      reason,
      requestId,
    })
    return res.json({ success: true, ...result })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error'
    const status = message === 'quality_review_contribution_not_found' ? 404 : 500
    return res.status(status).json({ error: message })
  }
})

export const qualityReviewRouter = router
