import { SOUND_CONFIG, NOTE_FREQ } from './config'
import type { EnrichedEvent, SoundParams } from './types'

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

  async init(): Promise<void> {
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

    // Generate impulse response for reverb
    await this.createReverbImpulse()

    // Connect: source -> [dry + reverb] -> master -> output
    this.convolver.connect(this.reverbGain)
    this.reverbGain.connect(this.masterGain)
    this.dryGain.connect(this.masterGain)
    this.masterGain.connect(this.ctx.destination)

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
  }

  private async createReverbImpulse(): Promise<void> {
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
  }

  playSound(config: SoundParams, pan = 0, sessionKey: string | null = null): void {
    if (!this.ctx || this.muted) return

    const now = this.ctx.currentTime
    const notes = config.notes || (config.note ? [config.note] : [])

    // Use session's 3D panner if available, otherwise create stereo panner
    const sessionPanner = sessionKey ? this.sessionPanners.get(sessionKey) : null

    notes.forEach((note, i) => {
      const freq = NOTE_FREQ[note] || 440
      const delay = i * 0.05 // Slight delay for chords

      // Create oscillator
      const osc = this.ctx!.createOscillator()
      osc.type = config.type || 'sine'
      osc.frequency.value = freq

      // Create gain for envelope
      const gainNode = this.ctx!.createGain()
      gainNode.gain.value = 0

      // Connect through session's 3D panner or fallback to stereo
      osc.connect(gainNode)
      if (sessionPanner) {
        // Route through session's pre-configured PannerNode
        gainNode.connect(sessionPanner)
      } else {
        // Fallback: create stereo panner for non-session sounds
        const panner = this.ctx!.createStereoPanner()
        panner.pan.value = pan
        gainNode.connect(panner)
        if (this.dryGain) panner.connect(this.dryGain)
        if (this.convolver) panner.connect(this.convolver)
      }

      // Envelope
      const attackTime = 0.01
      const gain = config.gain || 0.2

      gainNode.gain.setValueAtTime(0, now + delay)
      gainNode.gain.linearRampToValueAtTime(gain, now + delay + attackTime)
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + delay + config.duration)

      // Start and stop
      osc.start(now + delay)
      osc.stop(now + delay + config.duration + 0.1)
    })
  }

  playEvent(event: EnrichedEvent): void {
    const { event_type, tool_name, pan, machine_id, session_id } = event

    // Build session key for 3D panner lookup
    const sessionKey = machine_id && session_id ? `${machine_id}:${session_id}` : null

    // Get sound config based on event type
    let config: SoundParams

    if (event_type === 'PreToolUse' || event_type === 'PostToolUse') {
      // Use tool-specific sound
      const tools = SOUND_CONFIG.tools as Record<string, SoundParams>
      config = tools[tool_name] || tools.default

      // Make PostToolUse slightly different (higher pitch)
      if (event_type === 'PostToolUse' && config.note) {
        const noteKeys = Object.keys(NOTE_FREQ)
        const noteIndex = noteKeys.indexOf(config.note)
        if (noteIndex > 0 && noteIndex < noteKeys.length - 1) {
          config = {
            ...config,
            note: noteKeys[noteIndex + 1],
          }
        }
      }
    } else {
      // Use event type sound
      const eventConfig = SOUND_CONFIG[event_type]
      if (eventConfig && 'duration' in eventConfig) {
        config = eventConfig as SoundParams
      } else {
        const tools = SOUND_CONFIG.tools as Record<string, SoundParams>
        config = tools.default
      }
    }

    this.playSound(config, pan || 0, sessionKey)
  }
}
