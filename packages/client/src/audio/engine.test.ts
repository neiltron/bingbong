import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { EnrichedEvent } from '@bingbong/protocol'
import { AudioEngine } from './engine'
import type { SoundSystem, TriggerEvent } from './sound-system'

// Minimal Web Audio fake: just the nodes the engine builds.
const param = () => ({ value: 0, setValueAtTime() {} })
const node = (extra: object = {}) => ({ connect() {}, disconnect() {}, ...extra })

class FakeAudioContext {
  currentTime = 0
  sampleRate = 100
  destination = node()
  listener = Object.fromEntries(
    ['positionX', 'positionY', 'positionZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ'].map((k) => [k, param()]),
  )
  createGain = () => node({ gain: param() })
  createConvolver = () => node({ buffer: null })
  createPanner = () => node({ positionX: param(), positionY: param(), positionZ: param() })
  createStereoPanner = () => node({ pan: param() })
  createBuffer = (_ch: number, length: number) => ({ getChannelData: () => new Float32Array(length) })
}

/** Records every call the engine makes into the seam. */
function recordingSystem() {
  const log = { starts: 0, voices: [] as { dest: AudioNode; triggers: TriggerEvent[]; disposed: boolean }[] }
  const system: SoundSystem = {
    start: async () => void log.starts++,
    load() {},
    params: () => [],
    setParam() {},
    createVoice(dest) {
      const voice = { dest, triggers: [] as TriggerEvent[], disposed: false }
      log.voices.push(voice)
      return { trigger: (e) => void voice.triggers.push(e), dispose: () => void (voice.disposed = true) }
    },
    dispose() {},
  }
  return { log, system }
}

const event = (session_id?: string, extra: Partial<EnrichedEvent> = {}) =>
  ({ event_type: 'PreToolUse', tool_name: 'Read', machine_id: session_id && 'm', session_id, pan: 0, session_index: 0, color: '#fff', ...extra }) as EnrichedEvent

function setup() {
  const { log, system } = recordingSystem()
  const engine = new AudioEngine(system)
  engine.init()
  return { log, engine }
}

const realAudioContext = globalThis.AudioContext
beforeAll(() => void (globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext))
afterAll(() => void (globalThis.AudioContext = realAudioContext))

describe('AudioEngine', () => {
  test('init starts the system once', () => {
    const { log, engine } = setup()
    engine.init()
    expect(engine.initialized).toBe(true)
    expect(log.starts).toBe(1)
  })

  test('each session gets its own voice on its own panner; retriggers reuse it', () => {
    const { log, engine } = setup()
    const a = engine.createPannerForSession('m:a')
    const b = engine.createPannerForSession('m:b')
    engine.playEvent(event('a'))
    engine.playEvent(event('b'))
    engine.playEvent(event('a'))
    expect(log.voices.map((v) => v.dest)).toEqual([a, b] as unknown as AudioNode[])
    expect(log.voices.map((v) => v.triggers.length)).toEqual([2, 1])
  })

  test('playEvent passes flat fields plus the original event', () => {
    const { log, engine } = setup()
    engine.createPannerForSession('m:a')
    const e = event('a', { tool_input: { file_path: '/x' } } as Partial<EnrichedEvent>)
    engine.playEvent(e)
    expect(log.voices[0].triggers[0]).toEqual({ ...e, type: 'PreToolUse', tool: 'Read' })
  })

  test('removing a session disposes its voice; a recreated session gets a fresh one', () => {
    const { log, engine } = setup()
    engine.createPannerForSession('m:a')
    engine.playEvent(event('a'))
    engine.removePannerForSession('m:a')
    expect(log.voices[0].disposed).toBe(true)

    const panner = engine.createPannerForSession('m:a')
    engine.playEvent(event('a'))
    expect(log.voices).toHaveLength(2)
    expect(log.voices[1].dest).toBe(panner as unknown as AudioNode)
    expect(log.voices[1].disposed).toBe(false)
  })

  test('muted engine triggers nothing', () => {
    const { log, engine } = setup()
    engine.createPannerForSession('m:a')
    engine.toggleMute()
    engine.playEvent(event('a'))
    engine.playEvent(event())
    expect(log.voices.flatMap((v) => v.triggers)).toEqual([])
  })

  test('events without a session panner share the fallback voice', () => {
    const { log, engine } = setup()
    engine.playEvent(event())
    engine.playEvent(event('unknown'))
    expect(log.voices).toHaveLength(1)
    expect(log.voices[0].triggers).toHaveLength(2)
  })
})
