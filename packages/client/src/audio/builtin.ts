import { SOUND_CONFIG, NOTE_FREQ, type SoundParams } from './config'
import type { ParamSpec, SoundSystem, TriggerEvent, Voice } from './sound-system'

type Patch = typeof SOUND_CONFIG

/** Today's sounds: one oscillator + envelope per note, looked up in SOUND_CONFIG. */
export class BuiltinSoundSystem implements SoundSystem {
  private config: Patch = SOUND_CONFIG

  start(_ctx: AudioContext): Promise<void> {
    return Promise.resolve()
  }

  /** Accepts a SOUND_CONFIG-shaped object; undefined restores the default. Throws TypeError and keeps the old patch if invalid. */
  load(patch: unknown): void {
    if (patch !== undefined) validatePatch(patch)
    this.config = (patch as Patch | undefined) ?? SOUND_CONFIG
  }

  params(): ParamSpec[] {
    return []
  }

  setParam(_id: string, _value: number | boolean | string): void {}

  createVoice(dest: AudioNode): Voice {
    return {
      trigger: (event) => playNotes(dest, this.resolve(event)),
      // Nodes are one-shot: they stop on their own and get collected.
      dispose: () => {},
    }
  }

  dispose(): void {}

  private resolve({ type, tool }: TriggerEvent): SoundParams {
    const tools = this.config.tools as Record<string, SoundParams>

    if (type === 'PreToolUse' || type === 'PostToolUse') {
      const config = tools[tool || 'default'] || tools.default
      // PostToolUse plays one note higher than PreToolUse
      if (type === 'PostToolUse' && config.note) {
        const noteKeys = Object.keys(NOTE_FREQ)
        const i = noteKeys.indexOf(config.note)
        if (i > 0 && i < noteKeys.length - 1) return { ...config, note: noteKeys[i + 1] }
      }
      return config
    }

    const eventConfig = this.config[type]
    return eventConfig && 'duration' in eventConfig ? (eventConfig as SoundParams) : tools.default
  }
}

const OSC_TYPES = new Set(['sine', 'triangle', 'square', 'sawtooth'])
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function validatePatch(patch: unknown): void {
  if (!isObject(patch)) throw new TypeError('patch must be an object')
  const { tools, ...events } = patch
  if (!isObject(tools)) throw new TypeError('patch.tools must be an object')
  if (!('default' in tools)) throw new TypeError('patch.tools.default is required')
  const entries = [
    ...Object.entries(tools).map(([k, v]) => [`tools.${k}`, v] as const),
    ...Object.entries(events),
  ]
  for (const [key, s] of entries) {
    if (!isObject(s)) throw new TypeError(`${key} must be an object`)
    if (!Number.isFinite(s.duration)) throw new TypeError(`${key}.duration must be a finite number`)
    if ('gain' in s && !Number.isFinite(s.gain)) throw new TypeError(`${key}.gain must be a finite number`)
    if ('type' in s && !OSC_TYPES.has(s.type as string)) throw new TypeError(`${key}.type must be sine|triangle|square|sawtooth`)
  }
}

function playNotes(dest: AudioNode, config: SoundParams): void {
  const ctx = dest.context
  const now = ctx.currentTime
  const notes = config.notes || (config.note ? [config.note] : [])

  notes.forEach((note, i) => {
    const delay = i * 0.05 // Slight delay for chords

    const osc = ctx.createOscillator()
    osc.type = config.type || 'sine'
    osc.frequency.value = NOTE_FREQ[note] || 440

    const gainNode = ctx.createGain()
    gainNode.gain.value = 0
    osc.connect(gainNode)
    gainNode.connect(dest)

    // Envelope
    const attackTime = 0.01
    const gain = config.gain || 0.2
    gainNode.gain.setValueAtTime(0, now + delay)
    gainNode.gain.linearRampToValueAtTime(gain, now + delay + attackTime)
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + delay + config.duration)

    osc.start(now + delay)
    osc.stop(now + delay + config.duration + 0.1)
  })
}
