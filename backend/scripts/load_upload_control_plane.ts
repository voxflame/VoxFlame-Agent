interface LoadResult {
  status: number
  latencyMs: number
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const baseUrl = (process.env.VOXFLAME_LOAD_BASE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '')
const bearerToken = process.env.VOXFLAME_LOAD_BEARER_TOKEN || ''
const totalRequests = positiveInteger(process.env.VOXFLAME_LOAD_REQUESTS, 1000)
const concurrency = positiveInteger(process.env.VOXFLAME_LOAD_CONCURRENCY, 50)
const endpoint = bearerToken ? '/api/upload/sign' : '/health'
let cursor = 0

async function runRequest(index: number): Promise<LoadResult> {
  const startedAt = performance.now()
  const response = await fetch(`${baseUrl}${endpoint}`, bearerToken ? {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename: `dataset/load-test/synthetic-${Date.now()}-${index}.wav`,
      contentType: 'audio/wav',
    }),
  } : undefined)
  return { status: response.status, latencyMs: performance.now() - startedAt }
}

async function worker(results: LoadResult[]): Promise<void> {
  while (cursor < totalRequests) {
    const index = cursor
    cursor += 1
    try {
      results.push(await runRequest(index))
    } catch {
      results.push({ status: 0, latencyMs: 0 })
    }
  }
}

async function main(): Promise<void> {
  const results: LoadResult[] = []
  const startedAt = performance.now()
  await Promise.all(Array.from({ length: Math.min(concurrency, totalRequests) }, () => worker(results)))
  const elapsedSeconds = Math.max(0.001, (performance.now() - startedAt) / 1000)
  const latencies = results.map((result) => result.latencyMs).sort((a, b) => a - b)
  const percentile = (ratio: number): number => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * ratio))] ?? 0
  const statuses = Object.fromEntries(
    [...new Set(results.map((result) => result.status))]
      .sort((a, b) => a - b)
      .map((status) => [String(status), results.filter((result) => result.status === status).length]),
  )
  console.log(JSON.stringify({
    endpoint,
    totalRequests,
    concurrency,
    requestsPerSecond: Number((results.length / elapsedSeconds).toFixed(2)),
    latencyMs: {
      p50: Number(percentile(0.5).toFixed(2)),
      p95: Number(percentile(0.95).toFixed(2)),
      p99: Number(percentile(0.99).toFixed(2)),
    },
    statuses,
  }, null, 2))
}

void main()
