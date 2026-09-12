import fs from 'node:fs'
import path from 'node:path'

import { NextResponse } from 'next/server'

import { getCorpusReviewerAccess } from '@/lib/corpus-review/reviewer-access'
import { resolveActiveRecordingManifestRows } from '@/lib/corpus/recording-manifest-events.mjs'

export const dynamic = 'force-dynamic'

function configuredManifestPaths(): string[] {
  return (process.env.VOXFLAME_CORPUS_REVIEW_MANIFESTS ?? '')
    .split(/[;,\n]/u)
    .map((value) => value.trim())
    .filter(Boolean)
}

function manifestArtifactRoot(manifestPath: string): string {
  return path.dirname(path.dirname(path.dirname(path.resolve(manifestPath))))
}

function safeRecordingId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,100}$/u.test(value)
}

function findAudioPath(recordingId: string): string | null {
  const rows = configuredManifestPaths().flatMap((manifestPath) => {
    if (!fs.existsSync(manifestPath)) return []
    return fs.readFileSync(manifestPath, 'utf8').split(/\r?\n/u).filter(Boolean).flatMap((line) => {
      try {
        return [{
          ...(JSON.parse(line) as { recording_id?: string; metadata?: { recording_id?: string }; audio?: { path?: string } }),
          manifestPath,
        }]
      } catch {
        return []
      }
    })
  })
  for (const row of resolveActiveRecordingManifestRows(rows)) {
    const rowId = row.recording_id ?? row.metadata?.recording_id
    const audioPath = row.audio?.path
    if (rowId !== recordingId || !audioPath || path.isAbsolute(audioPath)) continue
    const root = manifestArtifactRoot(row.manifestPath)
    const resolved = path.resolve(root, audioPath)
    if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) continue
    return resolved
  }
  return null
}

export async function GET(
  _request: Request,
  context: { params: { recordingId: string } },
) {
  const access = await getCorpusReviewerAccess()
  if (!access.authenticated) return NextResponse.json({ error: 'authentication_required' }, { status: 401 })
  if (!access.authorized) {
    return NextResponse.json({ error: 'reviewer_access_required' }, { status: 403 })
  }
  const recordingId = decodeURIComponent(context.params.recordingId)
  if (!safeRecordingId(recordingId)) return NextResponse.json({ error: 'invalid_recording_id' }, { status: 400 })
  const audioPath = findAudioPath(recordingId)
  if (!audioPath || !fs.existsSync(audioPath)) return NextResponse.json({ error: 'audio_unavailable' }, { status: 404 })
  const stat = fs.statSync(audioPath)
  if (!stat.isFile() || stat.size === 0) return NextResponse.json({ error: 'audio_unavailable' }, { status: 404 })
  const buffer = fs.readFileSync(audioPath)
  if (buffer.subarray(0, 4).toString('ascii') !== 'RIFF' || buffer.subarray(8, 12).toString('ascii') !== 'WAVE') {
    return NextResponse.json({ error: 'audio_unavailable' }, { status: 404 })
  }
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
