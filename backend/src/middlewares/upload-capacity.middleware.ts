import type { NextFunction, Request, Response } from 'express'

import {
  uploadCapacityService,
  type UploadCapacityOperation,
} from '../services/upload-capacity.service'

export function uploadCapacityMiddleware(operation: UploadCapacityOperation) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const release = uploadCapacityService.acquire(operation)
    if (!release) {
      res.setHeader('Retry-After', '2')
      return res.status(503).json({
        error: 'upload_capacity_exceeded',
        retryAfterSeconds: 2,
      })
    }

    res.once('finish', release)
    res.once('close', release)
    return next()
  }
}
