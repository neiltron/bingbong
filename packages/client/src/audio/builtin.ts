import { SOUND_CONFIG, NOTE_FREQ, type SoundParams } from './config'
import type { ParamSpec, SoundSystem, TriggerEvent, Voice } from './sound-system'

type Patch = typeof SOUND_CONFIG
type Value = number | boolean | string

const PARAMS: ParamSpec[] = [
  { id: 'attack', label: 'Attack', type: 'number', default: 0.01, min: 0.001, max: 0.1, step: 0.001 },
  { id: 'length', label: 'Length', type: 'number', default: 1, min: 0.25, max: 3, step: 0.05 },
  { id: 'octave', label: 'Octave', type: 'number', default: 0, min: -2, max: 2, step: 1 },
  {
    id: 'waveform',
    label: 'Waveform',
    type: 'string',
    default: 'default',
    options: ['default', 'sine', 'triangle', 'square', 'sawtooth'],
  },
]

interface Shaping {
  attack: number
  length: number
  octave: number
  waveform: string
}

/** Today's sounds: one oscillator + envelope per note, looked up in SOUND_CONFIG. */
export class BuiltinSoundSystem implements SoundSystem {
  private config: Patch = SOUND_CONFIG
  private values: Record<string, Value> = Object.fromEntries(PARAMS.map((p) => [p.id, p.default]))

  start(_ctx: AudioContext): Promise<void> {
    return Promise.resolve()
  }

  /** Accepts a SOUND_CONFIG-shaped object; undefined restores the default. Throws TypeError and keeps the old patch if invalid. */
  load(patch: unknown): void {
    if (patch !== undefined) validatePatch(patch)
    this.config = (patch as Patch | undefined) ?? SOUND_CONFIG
  }

  params(): ParamSpec[] {
    return PARAMS
  }

  /** Unknown ids are ignored; numbers are clamped, strings must be one of `options`. */
  setParam(id: string, value: Value): void {
    const spec = PARAMS.find((p) => p.id === id)
    if (!spec) return
    if (spec.type === 'number') {
      const n = Number(value)
      if (Number.isFinite(n)) this.values[id] = Math.min(spec.max!, Math.max(spec.min!, n))
    } else if (spec.type === 'string') {
      this.values[id] = spec.options!.includes(String(value)) ? String(value) : spec.default
    } else {
      this.values[id] = Boolean(value)
    }
  }

  createVoice(dest: AudioNode): Voice {
    return {
      trigger: (event) => playNotes(dest, this.resolve(event), this.values as unknown as Shaping),
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

function playNotes(dest: AudioNode, config: SoundParams, { attack, length, octave, waveform }: Shaping): void {
  const ctx = dest.context
  const now = ctx.currentTime
  const notes = config.notes || (config.note ? [config.note] : [])

  notes.forEach((note, i) => {
    const delay = i * 0.05 // Slight delay for chords

    const osc = ctx.createOscillator()
    osc.type = waveform !== 'default' ? (waveform as OscillatorType) : config.type || 'sine'
    osc.frequency.value = (NOTE_FREQ[note] || 440) * 2 ** octave

    const gainNode = ctx.createGain()
    gainNode.gain.value = 0
    osc.connect(gainNode)
    gainNode.connect(dest)

    // Envelope (decay never ends before the attack peaks)
    const duration = Math.max(config.duration * length, attack)
    const gain = config.gain || 0.2
    gainNode.gain.setValueAtTime(0, now + delay)
    gainNode.gain.linearRampToValueAtTime(gain, now + delay + attack)
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + delay + duration)

    osc.start(now + delay)
    osc.stop(now + delay + duration + 0.1)
  })
}
