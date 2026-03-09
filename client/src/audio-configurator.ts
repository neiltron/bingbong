import type {
  AudioConfigMessage,
  AudioConfigPatch,
  AudioConfigPatchMessage,
  AudioConfigReplaceMessage,
  AudioConfigSnapshot,
  AudioGlobalConfig,
  SessionPosition,
} from './types'

const STORAGE_KEY = 'bingbong:audio-config:v1'

const DEFAULT_GLOBAL: AudioGlobalConfig = {
  volume: 0.7,
  reverb: 0.3,
  muted: false,
}

interface StoredAudioConfig {
  global?: Partial<AudioGlobalConfig>
  session_positions?: Record<string, SessionPosition>
}

function clamp01(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(1, value))
}

function normalizePosition(value: SessionPosition | undefined): SessionPosition {
  return {
    x: clamp01(value?.x ?? 0.5, 0.5),
    y: clamp01(value?.y ?? 0.5, 0.5),
  }
}

export class AudioConfigurator {
  private socket: WebSocket | null = null
  private global: AudioGlobalConfig = { ...DEFAULT_GLOBAL }
  private sessionPositions = new Map<string, SessionPosition>()

  constructor() {
    this.loadFromStorage()
  }

  attachWebSocket(socket: WebSocket): void {
    this.socket = socket
    this.sendReplace()
  }

  detachWebSocket(socket?: WebSocket): void {
    if (!socket || this.socket === socket) {
      this.socket = null
    }
  }

  getVolume(): number {
    return this.global.volume
  }

  getReverb(): number {
    return this.global.reverb
  }

  isMuted(): boolean {
    return this.global.muted
  }

  setVolume(value: number): void {
    const nextVolume = clamp01(value, this.global.volume)
    this.global.volume = nextVolume
    this.persistToStorage()
    this.sendPatch({ global: { volume: nextVolume } })
  }

  setReverb(value: number): void {
    const nextReverb = clamp01(value, this.global.reverb)
    this.global.reverb = nextReverb
    this.persistToStorage()
    this.sendPatch({ global: { reverb: nextReverb } })
  }

  toggleMute(): boolean {
    this.global.muted = !this.global.muted
    this.persistToStorage()
    this.sendPatch({ global: { muted: this.global.muted } })
    return this.global.muted
  }

  registerSession(sessionKey: string): void {
    if (!sessionKey) return

    const pos = normalizePosition(this.sessionPositions.get(sessionKey))
    this.sessionPositions.set(sessionKey, pos)
    this.persistToStorage()
    this.sendPatch({ session_positions: { [sessionKey]: pos } })
  }

  updateSessionPosition(sessionKey: string, x: number, y: number): void {
    if (!sessionKey) return

    const pos = normalizePosition({ x, y })
    this.sessionPositions.set(sessionKey, pos)
    this.persistToStorage()
    this.sendPatch({ session_positions: { [sessionKey]: pos } })
  }

  removeSession(sessionKey: string): void {
    if (!sessionKey) return
    if (!this.sessionPositions.has(sessionKey)) return

    this.sessionPositions.delete(sessionKey)
    this.persistToStorage()
    this.sendPatch({ session_positions: { [sessionKey]: null } })
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as StoredAudioConfig

      this.global = {
        volume: clamp01(parsed.global?.volume ?? DEFAULT_GLOBAL.volume, DEFAULT_GLOBAL.volume),
        reverb: clamp01(parsed.global?.reverb ?? DEFAULT_GLOBAL.reverb, DEFAULT_GLOBAL.reverb),
        muted: Boolean(parsed.global?.muted),
      }

      for (const [sessionKey, position] of Object.entries(parsed.session_positions || {})) {
        this.sessionPositions.set(sessionKey, normalizePosition(position))
      }
    } catch {
      this.global = { ...DEFAULT_GLOBAL }
      this.sessionPositions.clear()
    }
  }

  private persistToStorage(): void {
    const serialized: StoredAudioConfig = {
      global: this.global,
      session_positions: Object.fromEntries(this.sessionPositions),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized))
  }

  private buildSnapshot(): AudioConfigSnapshot {
    return {
      global: this.global,
      session_positions: Object.fromEntries(this.sessionPositions),
    }
  }

  private sendReplace(): void {
    const message: AudioConfigReplaceMessage = {
      type: 'audio_config.replace',
      version: 1,
      payload: this.buildSnapshot(),
    }
    this.sendMessage(message)
  }

  private sendPatch(patch: AudioConfigPatch): void {
    const message: AudioConfigPatchMessage = {
      type: 'audio_config.patch',
      version: 1,
      payload: patch,
    }
    this.sendMessage(message)
  }

  private sendMessage(message: AudioConfigMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    this.socket.send(JSON.stringify(message))
  }
}
