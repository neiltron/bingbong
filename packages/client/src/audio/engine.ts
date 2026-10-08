import type { EnrichedEvent } from '@bingbong/protocol'
import { BuiltinSoundSystem } from './builtin'
import type { SoundSystem, Voice } from './sound-system'

export class AudioEngine {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private convolver: ConvolverNode | null = null
  private reverbGain: GainNode | null = null
  private dryGain: GainNode | null = null
  private muted = false
  private volume = 0.7
  private reverbAmount = 0.3
  private sessionPanners = new Map<string, PannerNode>()
  private sessionVoices = new Map<string, Voice>()
  private fallbackPanner: StereoPannerNode | null = null
  private fallbackVoice: Voice | null = null

  /** Routing and space live here; timbre is delegated to the sound system. */
  constructor(private readonly system: SoundSystem = new BuiltinSoundSystem()) {}

  get initialized(): boolean {
    return !!this.ctx
  }

  get isMuted(): boolean {
    return this.muted
  }

  // Must be called from a user gesture handler.
  // AudioContext creation is synchronous to satisfy browser gesture requirements.
  // Reverb impulse generation happens async afterward.
  init(): void {
    if (this.ctx) return

    this.ctx = new AudioContext()

    // Create master gain
    this.masterGain = this.ctx.createGain()
    this.masterGain.gain.value = this.volume

    // Create reverb path
    this.convolver = this.ctx.createConvolver()
    this.reverbGain = this.ctx.createGain()
    this.reverbGain.gain.value = this.reverbAmount

    this.dryGain = this.ctx.createGain()
    this.dryGain.gain.value = 1 - this.reverbAmount

    // Connect: source -> [dry + reverb] -> master -> output
    this.convolver.connect(this.reverbGain)
    this.reverbGain.connect(this.masterGain)
    this.dryGain.connect(this.masterGain)
    this.masterGain.connect(this.ctx.destination)

    this.system.start(this.ctx).catch((err) => console.error('[audio] sound system failed to start', err))

    // Set listener at origin for 3D audio
    const listener = this.ctx.listener
    if (listener.positionX) {
      listener.positionX.setValueAtTime(0, this.ctx.currentTime)
      listener.positionY.setValueAtTime(0, this.ctx.currentTime)
      listener.positionZ.setValueAtTime(0, this.ctx.currentTime)
      listener.forwardX.setValueAtTime(0, this.ctx.currentTime)
      listener.forwardY.setValueAtTime(0, this.ctx.currentTime)
      listener.forwardZ.setValueAtTime(-1, this.ctx.currentTime)
      listener.upX.setValueAtTime(0, this.ctx.currentTime)
      listener.upY.setValueAtTime(1, this.ctx.currentTime)
      listener.upZ.setValueAtTime(0, this.ctx.currentTime)
    }

    // Generate reverb impulse async (non-blocking)
    this.createReverbImpulse()
  }

  private createReverbImpulse(): void {
    if (!this.ctx || !this.convolver) return

    const duration = 2
    const decay = 2
    const sampleRate = this.ctx.sampleRate
    const length = sampleRate * duration
    const impulse = this.ctx.createBuffer(2, length, sampleRate)

    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel)
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay)
      }
    }

    this.convolver.buffer = impulse
  }

  setVolume(value: number): void {
    this.volume = value
    if (this.masterGain) {
      this.masterGain.gain.value = this.muted ? 0 : value
    }
  }

  setReverb(value: number): void {
    this.reverbAmount = value
    if (this.reverbGain && this.dryGain) {
      this.reverbGain.gain.value = value
      this.dryGain.gain.value = 1 - value * 0.5
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted
    if (this.masterGain) {
      this.masterGain.gain.value = this.muted ? 0 : this.volume
    }
    return this.muted
  }

  createPannerForSession(sessionKey: string): PannerNode | null {
    if (!this.ctx) return null
    if (this.sessionPanners.has(sessionKey)) {
      return this.sessionPanners.get(sessionKey)!
    }

    const panner = this.ctx.createPanner()
    panner.panningModel = 'HRTF'
    panner.distanceModel = 'inverse'
    panner.refDistance = 1
    panner.maxDistance = 10
    panner.rolloffFactor = 1.5 // Dramatic falloff
    panner.coneInnerAngle = 360
    panner.coneOuterAngle = 360

    // Connect to dry/wet paths
    if (this.dryGain) panner.connect(this.dryGain)
    if (this.convolver) panner.connect(this.convolver)

    this.sessionPanners.set(sessionKey, panner)
    return panner
  }

  updatePannerPosition(sessionKey: string, normX: number, normY: number): void {
    const panner = this.sessionPanners.get(sessionKey)
    if (!panner || !this.ctx) return

    // Convert normalized coords (0-1) to 3D space (-5 to +5)
    const x = (normX - 0.5) * 10
    const z = (0.5 - normY) * 10 // Y inverted for front/back

    panner.positionX.setValueAtTime(x, this.ctx.currentTime)
    panner.positionY.setValueAtTime(0, this.ctx.currentTime)
    panner.positionZ.setValueAtTime(z, this.ctx.currentTime)
  }

  removePannerForSession(sessionKey: string): void {
    const panner = this.sessionPanners.get(sessionKey)
    if (panner) {
      panner.disconnect()
      this.sessionPanners.delete(sessionKey)
    }
    this.sessionVoices.get(sessionKey)?.dispose()
    this.sessionVoices.delete(sessionKey)
  }

  playEvent(event: EnrichedEvent): void {
    if (!this.ctx || this.muted) return

    const { machine_id, session_id } = event
    const sessionKey = machine_id && session_id ? `${machine_id}:${session_id}` : null
    const panner = sessionKey ? this.sessionPanners.get(sessionKey) : undefined

    let voice: Voice
    if (sessionKey && panner) {
      voice = this.sessionVoices.get(sessionKey) ?? this.system.createVoice(panner)
      this.sessionVoices.set(sessionKey, voice)
    } else {
      // Non-session path: shared stereo panner, re-aimed per event.
      // ponytail: overlapping fallback notes with different pans share one panner;
      // give each pan its own panner+voice if that ever becomes audible.
      if (!this.fallbackPanner) {
        this.fallbackPanner = this.ctx.createStereoPanner()
        if (this.dryGain) this.fallbackPanner.connect(this.dryGain)
        if (this.convolver) this.fallbackPanner.connect(this.convolver)
      }
      this.fallbackPanner.pan.value = event.pan || 0
      this.fallbackVoice ??= this.system.createVoice(this.fallbackPanner)
      voice = this.fallbackVoice
    }

    voice.trigger({ ...event, type: event.event_type, tool: event.tool_name })
  }
}
