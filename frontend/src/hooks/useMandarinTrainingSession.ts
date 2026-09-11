'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { VoxFlameRecordingEnvelope } from '@/lib/recording/recording-contract'
import type { LatestUserTranscriptSnapshot } from '@/lib/realtime-audio/session-types'
import {
  createRecordingQualityAccumulator,
  type RecordingQualityAccumulator,
} from '@/lib/audio/recording-quality'
import {
  getRecordingInputDeviceMetadata,
  readPreferredMicrophoneDevice,
} from '@/lib/audio/microphone-preferences'
import { calculateNormalizedInputLevel } from '@/lib/audio/microphone-input-feedback'
import { LocalPcmWavRecorder } from '@/lib/audio/local-pcm-wav-recorder'
import { pickPreferredTrainingTranscriptCandidate } from '@/lib/training/final-transcript'
import { useRtcAgentSession } from './useRtcAgentSession'
import { reportFrontendDiagnostic, toProductMessage } from '@/lib/ui/product-message'

type SessionStatus = 'idle' | 'connecting' | 'ready' | 'recording' | 'processing' | 'error'

interface StopRecordingResult {
  clientCaptureId: string
  immediateTranscript: string
  recording: VoxFlameRecordingEnvelope | null
  transcriptCompletion: Promise<{
    transcript: string
    transcriptLatencyMs: number
  }>
}

interface PracticeTranscriptState {
  clientCaptureId: string | null
  transcript: string
}

function createEmptyTranscriptSnapshot(): LatestUserTranscriptSnapshot {
  return {
    text: '',
    clientCaptureId: null,
  }
}

function createEmptyPracticeTranscriptState(): PracticeTranscriptState {
  return {
    clientCaptureId: null,
    transcript: '',
  }
}

interface UseMandarinTrainingSessionOptions {
  userId?: string
  accessToken?: string
  shortUtteranceMode?: boolean
}

function transcriptLength(text: string): number {
  return text.replace(/\s+/g, '').trim().length
}

export function useMandarinTrainingSession(
  options: UseMandarinTrainingSessionOptions = {},
) {
  const { userId, accessToken, shortUtteranceMode = false } = options
  const [error, setError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const sessionIdRef = useRef<string | null>(null)
  const latestUserTranscriptRef = useRef<LatestUserTranscriptSnapshot>(createEmptyTranscriptSnapshot())
  const currentASRTextRef = useRef('')
  const bestObservedTranscriptRef = useRef('')
  const recordingBaselineRef = useRef<LatestUserTranscriptSnapshot>(createEmptyTranscriptSnapshot())
  const activeTranscriptStateRef = useRef<PracticeTranscriptState>(createEmptyPracticeTranscriptState())
  const activeClientCaptureIdRef = useRef<string | null>(null)
  const recorderRef = useRef<LocalPcmWavRecorder | null>(null)
  const recorderTrackRef = useRef<MediaStreamTrack | null>(null)
  const recorderOwnsTrackRef = useRef(false)
  const recordingStartedAtRef = useRef<number | null>(null)
  const recordingQualityRef = useRef<RecordingQualityAccumulator | null>(null)
  const recordingQualityTimerRef = useRef<number | null>(null)

  const rtc = useRtcAgentSession({
    userId,
    accessToken,
    mode: 'training',
    surface: 'training_workspace',
    requestedCapabilities: [
      'transport_send_control',
      'workspace_snapshot_read',
      'voice_profile_update',
      'upload_artifact_persist',
    ],
    connectionNotice: null,
  })
  const {
    sessionId,
    currentASRText,
    latestUserTranscript,
    lastVoiceProfileSync,
    isRecording: rtcIsRecording,
    isConnected,
    error: rtcError,
    startRecording: startRtcRecording,
    stopRecording: stopRtcRecording,
    sendControlEvent,
    disconnect: disconnectRtc,
    getMicrophoneStreamTrack,
    getMicrophoneMediaStream,
    getLatestUserTranscriptSnapshot,
    getCachedTranscriptByCaptureId,
    analyser,
  } = rtc

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    const nextSnapshot = getLatestUserTranscriptSnapshot()
    latestUserTranscriptRef.current = nextSnapshot
    if (
      (!nextSnapshot.clientCaptureId || nextSnapshot.clientCaptureId === activeClientCaptureIdRef.current)
      && transcriptLength(latestUserTranscript) > transcriptLength(bestObservedTranscriptRef.current)
    ) {
      bestObservedTranscriptRef.current = latestUserTranscript
    }
  }, [getLatestUserTranscriptSnapshot, latestUserTranscript])

  const readCapturedTranscript = useCallback((clientCaptureId: string): string => {
    const cached = getCachedTranscriptByCaptureId(clientCaptureId)
    if (cached && cached.clientCaptureId === clientCaptureId) {
      return cached.text.trim()
    }
    return ''
  }, [getCachedTranscriptByCaptureId])

  const updateActiveTranscriptState = useCallback((
    clientCaptureId: string | null,
    transcript: string,
  ) => {
    activeTranscriptStateRef.current = {
      clientCaptureId,
      transcript,
    }
  }, [])

  useEffect(() => {
    currentASRTextRef.current = currentASRText
    if (
      activeTranscriptStateRef.current.clientCaptureId === activeClientCaptureIdRef.current
      && transcriptLength(currentASRText) > transcriptLength(bestObservedTranscriptRef.current)
    ) {
      bestObservedTranscriptRef.current = currentASRText
    }
  }, [currentASRText])

  const beginLocalRecording = useCallback(async () => {
    const sourceStream = getMicrophoneMediaStream()
    const sourceTrack = sourceStream?.getAudioTracks()[0] ?? getMicrophoneStreamTrack()
    if (!sourceTrack) {
      return null
    }

    let recorderTrack: MediaStreamTrack = sourceTrack
    let ownsTrack = false

    try {
      recorderTrack = sourceTrack.clone()
      ownsTrack = true
    } catch {
      recorderTrack = sourceTrack
      ownsTrack = false
    }

    try {
      const recorder = new LocalPcmWavRecorder(recorderTrack)
      await recorder.start()

      recorderTrackRef.current = recorderTrack
      recorderOwnsTrackRef.current = ownsTrack
      recordingStartedAtRef.current = Date.now()
      const analyserNode = analyser
      const qualityAccumulator = createRecordingQualityAccumulator()
      recordingQualityRef.current = qualityAccumulator
      if (recordingQualityTimerRef.current !== null) {
        window.clearInterval(recordingQualityTimerRef.current)
      }
      if (analyserNode) {
        const data = new Uint8Array(analyserNode.frequencyBinCount)
        recordingQualityTimerRef.current = window.setInterval(() => {
          analyserNode.getByteTimeDomainData(data)
          qualityAccumulator.observeLevel(calculateNormalizedInputLevel(data))
        }, 120)
      }

      recorderRef.current = recorder
      return recorder
    } catch (error) {
      if (ownsTrack) {
        try {
          recorderTrack.stop()
        } catch {
          // ignore cleanup error
        }
      }

      reportFrontendDiagnostic('training-recorder-start', error)
      throw new Error(toProductMessage(error, 'recording'))
    }
  }, [analyser, getMicrophoneMediaStream, getMicrophoneStreamTrack])

  const stopLocalRecording = useCallback(async (): Promise<StopRecordingResult['recording']> => {
    const recorder = recorderRef.current
    const startedAt = recordingStartedAtRef.current
    recorderRef.current = null
    recordingStartedAtRef.current = null
    if (recordingQualityTimerRef.current !== null) {
      window.clearInterval(recordingQualityTimerRef.current)
      recordingQualityTimerRef.current = null
    }

    const finalize = async (): Promise<StopRecordingResult['recording']> => {
      const track = recorderTrackRef.current
      recorderTrackRef.current = null
      const qualityMetrics = recordingQualityRef.current
        ? recordingQualityRef.current.finish(
            startedAt ? Math.max(300, Date.now() - startedAt) : 0,
          )
        : null
      recordingQualityRef.current = null
      const ownsTrack = recorderOwnsTrackRef.current
      recorderOwnsTrackRef.current = false
      const pcmRecording = await recorder?.stop()
      if (ownsTrack) {
        track?.stop()
      }

      if (!pcmRecording) {
        return null
      }

      const stoppedAt = Date.now()
      const durationMs = Math.max(
        pcmRecording.durationMs,
        startedAt ? Math.max(300, stoppedAt - startedAt) : 0,
      )
      const inputDevice = getRecordingInputDeviceMetadata(
        track,
        readPreferredMicrophoneDevice(),
      )

      return {
        recordingId: crypto.randomUUID(),
        sessionId: sessionIdRef.current ?? `training_local_${stoppedAt}`,
        mode: 'training',
        sourceSurface: 'web',
        collectionMode: 'supervised',
        createdAt: new Date(startedAt ?? stoppedAt).toISOString(),
        startedAt: new Date(startedAt ?? stoppedAt).toISOString(),
        stoppedAt: new Date(stoppedAt).toISOString(),
        audio: {
          blob: pcmRecording.blob,
          format: 'audio/wav',
          sampleRate: pcmRecording.sampleRate,
          channelCount: pcmRecording.channelCount,
          durationMs,
          durationSeconds: Math.max(1, Math.round(durationMs / 1000)),
          fileSizeBytes: pcmRecording.fileSizeBytes,
          captureTransport: 'local_pcm_stream',
          inputDevice,
          quality: qualityMetrics ? {
            durationMs: qualityMetrics.duration_ms,
            speechDurationMs: qualityMetrics.speech_duration_ms,
            leadingSilenceMs: qualityMetrics.leading_silence_ms,
            trailingSilenceMs: qualityMetrics.trailing_silence_ms,
            silenceRatio: qualityMetrics.silence_ratio,
            inputLevelRms: qualityMetrics.input_level_rms,
            inputLevelPeak: qualityMetrics.input_level_peak,
            disposition: qualityMetrics.quality_disposition,
            reasons: qualityMetrics.quality_reasons,
          } : undefined,
        },
      }
    }

    if (!recorder) {
      return finalize()
    }

    return finalize()
  }, [])

  const readScopedFinalTranscript = useCallback((
    baseline: LatestUserTranscriptSnapshot,
    clientCaptureId: string,
  ): string => {
    void baseline
    return readCapturedTranscript(clientCaptureId)
  }, [readCapturedTranscript])

  const waitForFinalTranscript = useCallback(async (
    baseline: LatestUserTranscriptSnapshot,
    clientCaptureId: string,
    latestInterim: string,
    bestObserved: string,
  ): Promise<string> => {
    const deadline = Date.now() + (shortUtteranceMode ? 8_500 : 7_000)

    while (Date.now() < deadline) {
      const latestFinal = readScopedFinalTranscript(baseline, clientCaptureId)
      if (latestFinal) {
        return latestFinal
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, shortUtteranceMode ? 140 : 120)
      })
    }

    return pickPreferredTrainingTranscriptCandidate({
      baseline: baseline.text,
      latestFinal: readScopedFinalTranscript(baseline, clientCaptureId),
      latestInterim,
      bestObserved,
    })
  }, [readScopedFinalTranscript, shortUtteranceMode])

  const startRecording = useCallback(async () => {
    setError(null)
    setIsConnecting(true)

    try {
      const clientCaptureId = crypto.randomUUID()
      activeClientCaptureIdRef.current = clientCaptureId
      recordingBaselineRef.current = latestUserTranscriptRef.current
      latestUserTranscriptRef.current = createEmptyTranscriptSnapshot()
      updateActiveTranscriptState(clientCaptureId, '')
      currentASRTextRef.current = ''
      bestObservedTranscriptRef.current = ''
      await startRtcRecording({
        suppressGreeting: true,
        clientCaptureId,
        shortUtteranceExpected: shortUtteranceMode,
      })
      const recorder = await beginLocalRecording()

      if (!recorder) {
        throw new Error('录音失败，请重试。')
      }

    } catch (recordingError) {
      const message = toProductMessage(recordingError, 'recording')
      setError(message)
      void stopRtcRecording(activeClientCaptureIdRef.current ?? undefined).catch(() => {
        void disconnectRtc()
      })
      throw recordingError
    } finally {
      setIsConnecting(false)
    }
  }, [beginLocalRecording, disconnectRtc, shortUtteranceMode, startRtcRecording, stopRtcRecording, updateActiveTranscriptState])

  const stopRecording = useCallback(async (): Promise<StopRecordingResult> => {
    setIsProcessing(true)

    try {
      const finalizeStartedAt = Date.now()
      const clientCaptureId = activeClientCaptureIdRef.current ?? crypto.randomUUID()
      const baseline = recordingBaselineRef.current
      const latestInterim = currentASRTextRef.current
      const bestObserved = bestObservedTranscriptRef.current
      const recordingPromise = stopLocalRecording()
      const rtcStopPromise = stopRtcRecording(clientCaptureId).catch((stopError: unknown) => {
        reportFrontendDiagnostic('training-rtc-stop', stopError)
        setError('录音已保留，连接正在自动恢复。')
        void disconnectRtc()
      })
      const transcriptCompletion = waitForFinalTranscript(
        baseline,
        clientCaptureId,
        latestInterim,
        bestObserved,
      ).then((transcript) => ({
        transcript: transcript.trim(),
        transcriptLatencyMs: Math.max(0, Date.now() - finalizeStartedAt),
      }))
      const [recording] = await Promise.all([
        recordingPromise,
        rtcStopPromise,
      ])
      const immediateTranscript = pickPreferredTrainingTranscriptCandidate({
        baseline: baseline.text,
        latestFinal: readScopedFinalTranscript(baseline, clientCaptureId),
        latestInterim,
        bestObserved,
      })

      return {
        clientCaptureId,
        immediateTranscript: immediateTranscript.trim(),
        recording,
        transcriptCompletion,
      }
    } finally {
      activeClientCaptureIdRef.current = null
      updateActiveTranscriptState(null, '')
      setIsProcessing(false)
    }
  }, [disconnectRtc, readScopedFinalTranscript, stopLocalRecording, stopRtcRecording, waitForFinalTranscript])

  const disconnect = useCallback(() => {
    setError(null)
    void stopLocalRecording()
    void disconnectRtc()
  }, [disconnectRtc, stopLocalRecording])

  const syncVoiceProfile = useCallback((payload: Record<string, unknown>) => {
    void sendControlEvent('update_voice_profile', payload).catch((eventError: unknown) => {
      reportFrontendDiagnostic('training-profile-sync', eventError)
      setError('训练记录同步失败，请重试。')
    })
  }, [sendControlEvent])

  const sessionError = error || rtcError
  const status: SessionStatus = sessionError
    ? 'error'
    : isProcessing
      ? 'processing'
      : rtcIsRecording
        ? 'recording'
        : isConnecting
          ? 'connecting'
          : isConnected
            ? 'ready'
            : 'idle'

  return {
    status,
    interimText: currentASRText,
    finalText: latestUserTranscript,
    latestVoiceProfileSync: lastVoiceProfileSync,
    error: sessionError,
    isRecording: rtcIsRecording,
    isProcessing,
    isConnected,
    sessionIntent: rtc.sessionIntent,
    sessionReadiness: rtc.sessionReadiness,
    grantedCapabilities: rtc.grantedCapabilities,
    analyser,
    startRecording,
    stopRecording,
    syncVoiceProfile,
    disconnect,
  }
}
