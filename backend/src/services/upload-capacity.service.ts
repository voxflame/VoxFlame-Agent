export type UploadCapacityOperation = 'sign' | 'complete'

export interface UploadCapacitySnapshot {
  operations: Record<UploadCapacityOperation, {
    active: number
    limit: number
    rejected: number
  }>
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export class UploadCapacityService {
  private readonly active: Record<UploadCapacityOperation, number> = { sign: 0, complete: 0 }
  private readonly rejected: Record<UploadCapacityOperation, number> = { sign: 0, complete: 0 }

  constructor(private readonly limits: Record<UploadCapacityOperation, number>) {}

  acquire(operation: UploadCapacityOperation): (() => void) | null {
    if (this.active[operation] >= this.limits[operation]) {
      this.rejected[operation] += 1
      return null
    }

    this.active[operation] += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.active[operation] = Math.max(0, this.active[operation] - 1)
    }
  }

  snapshot(): UploadCapacitySnapshot {
    return {
      operations: {
        sign: { active: this.active.sign, limit: this.limits.sign, rejected: this.rejected.sign },
        complete: { active: this.active.complete, limit: this.limits.complete, rejected: this.rejected.complete },
      },
    }
  }
}

export const uploadCapacityService = new UploadCapacityService({
  sign: positiveInteger(process.env.VOXFLAME_UPLOAD_SIGN_MAX_IN_FLIGHT, 200),
  complete: positiveInteger(process.env.VOXFLAME_UPLOAD_COMPLETE_MAX_IN_FLIGHT, 100),
})
