import { config } from '@/lib/config'

interface WindowWithWebkitAudioContext extends Window {
  webkitAudioContext?: typeof AudioContext
}

export interface LocalPcmWavRecording {
  blob: Blob
  sampleRate: number
  channelCount: number
  durationMs: number
  fileSizeBytes: number
}

function getAudioContextConstructor(): typeof AudioContext {
  if (typeof window === 'undefined') {
    throw new Error('当前环境不支持浏览器侧 PCM 录音。')
  }

  const candidate = globalThis.AudioContext
    ?? (window as WindowWithWebkitAudioContext).webkitAudioContext

  if (!candidate) {
    throw new Error('当前浏览器不支持本地 PCM 录音，请换到系统浏览器或更新浏览器后再试。')
  }

  return candidate
}

function createAudioContext(targetSampleRate: number): AudioContext {
  const AudioContextConstructor = getAudioContextConstructor()

  try {
    return new AudioContextConstructor({ sampleRate: targetSampleRate })
  } catch {
    return new AudioContextConstructor()
  }
}

function resample(samples: Float32Array, originalSampleRate: number, targetSampleRate: number): Float32Array {
  if (originalSampleRate === targetSampleRate) {
    return samples
  }

  const ratio = originalSampleRate / targetSampleRate
  const newLength = Math.round(samples.length / ratio)
  const result = new Float32Array(newLength)

  for (let index = 0; index < newLength; index += 1) {
    const sourceIndex = index * ratio
    const lower = Math.floor(sourceIndex)
    const upper = Math.min(lower + 1, samples.length - 1)
    const weight = sourceIndex - lower
    result[index] = samples[lower] * (1 - weight) + samples[upper] * weight
  }

  return result
}

function mixToMono(inputBuffer: AudioBuffer): Float32Array {
  if (inputBuffer.numberOfChannels === 1) {
    return inputBuffer.getChannelData(0).slice()
  }

  const mono = new Float32Array(inputBuffer.length)
  for (let channelIndex = 0; channelIndex < inputBuffer.numberOfChannels; channelIndex += 1) {
    const channel = inputBuffer.getChannelData(channelIndex)
    for (let sampleIndex = 0; sampleIndex < channel.length; sampleIndex += 1) {
      mono[sampleIndex] += channel[sampleIndex] / inputBuffer.numberOfChannels
    }
  }

  return mono
}

function floatTo16BitPcm(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length)

  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]))
    pcm[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
  }

  return pcm
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}

export function createPcmWavBlob(samples: Int16Array, sampleRate: number): Blob {
  const channelCount = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const blockAlign = channelCount * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * bytesPerSample
  const headerSize = 44
  const buffer = new ArrayBuffer(headerSize + dataSize)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, headerSize + dataSize - 8, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channelCount, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  new Int16Array(buffer, headerSize).set(samples)
  return new Blob([buffer], { type: 'audio/wav' })
}

export class LocalPcmWavRecorder {
  private audioContext: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private stream: MediaStream | null = null
  private readonly chunks: Int16Array[] = []
  private startedAt = 0
  private readonly track: MediaStreamTrack
  private readonly targetSampleRate: number

  constructor(
    track: MediaStreamTrack,
    targetSampleRate: number = config.audio.sampleRate,
  ) {
    this.track = track
    this.targetSampleRate = targetSampleRate
  }

  async start(): Promise<void> {
    this.startedAt = Date.now()
    this.audioContext = createAudioContext(this.targetSampleRate)

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume().catch(() => undefined)
    }

    this.stream = new MediaStream([this.track])
    this.source = this.audioContext.createMediaStreamSource(this.stream)
    this.processor = this.audioContext.createScriptProcessor(config.audio.bufferSize, 1, 1)

    this.processor.onaudioprocess = (event) => {
      const mono = mixToMono(event.inputBuffer)
      const resampled = resample(mono, event.inputBuffer.sampleRate, this.targetSampleRate)
      this.chunks.push(floatTo16BitPcm(resampled))

      const output = event.outputBuffer.getChannelData(0)
      output.fill(0)
    }

    this.source.connect(this.processor)
    this.processor.connect(this.audioContext.destination)
  }

  async stop(): Promise<LocalPcmWavRecording | null> {
    const sampleCount = this.chunks.reduce((total, chunk) => total + chunk.length, 0)

    this.processor?.disconnect()
    this.source?.disconnect()
    this.processor = null
    this.source = null
    this.stream = null

    const audioContext = this.audioContext
    this.audioContext = null
    void audioContext?.close().catch(() => undefined)

    if (sampleCount === 0) {
      return null
    }

    const samples = new Int16Array(sampleCount)
    let offset = 0
    for (const chunk of this.chunks) {
      samples.set(chunk, offset)
      offset += chunk.length
    }

    this.chunks.length = 0
    const blob = createPcmWavBlob(samples, this.targetSampleRate)
    const durationMs = Math.max(
      Math.round((samples.length / this.targetSampleRate) * 1000),
      this.startedAt ? Date.now() - this.startedAt : 0,
    )

    return {
      blob,
      sampleRate: this.targetSampleRate,
      channelCount: 1,
      durationMs,
      fileSizeBytes: blob.size,
    }
  }
}
