import type { NextFunction, Request, Response } from 'express'

interface AuthenticatedReviewRequest extends Request {
  user?: {
    id: string
    email: string
    role?: string
    userMetadata: Record<string, unknown>
  }
}

export function parseReviewerAllowlist(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(/[;,\s]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function qualityReviewerMiddleware(req: AuthenticatedReviewRequest, res: Response, next: NextFunction) {
  const reviewerEmail = req.user?.email.trim().toLowerCase() ?? ''
  const allowed = parseReviewerAllowlist(process.env.VOXFLAME_QUALITY_REVIEWER_EMAILS)
  if (!reviewerEmail || !allowed.has(reviewerEmail)) {
    return res.status(403).json({ error: 'Quality reviewer access required' })
  }
  return next()
}
