import { describe, expect, test } from 'bun:test'
import { BuiltinSoundSystem } from './builtin'

// Minimal Web Audio fake: records oscillators and node connections.
const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} })

function fakeContext() {
  const oscs: { type: string; freq: number; start: number; stop: number; out: any }[] = []
  const node = () => ({ connected: [] as unknown[], connect(n: unknown) { this.connected.push(n) } })
  const ctx = {
    currentTime: 0,
    createGain: () => ({ ...node(), gain: param() }),
    createOscillator() {
      const rec = { type: '', freq: 0, start: -1, stop: -1, out: null as any }
      oscs.push(rec)
      return {
        frequency: param(),
        set type(t: string) { rec.type = t },
        connect(n: unknown) { rec.out = n },
        start(t: number) { rec.start = t; rec.freq = this.frequency.value },
        stop(t: number) { rec.stop = t },
      }
    },
  }
  const dest = { context: ctx }
  return { oscs, dest: dest as unknown as AudioNode }
}

function play(event: { type: string; tool?: string }, params: Record<string, number | boolean | string> = {}) {
  const { oscs, dest } = fakeContext()
  const system = new BuiltinSoundSystem()
  for (const [id, value] of Object.entries(params)) system.setParam(id, value)
  system.createVoice(dest).trigger(event)
  return { oscs, dest }
}

const read = { type: 'PreToolUse', tool: 'Read' } // A4, sine, duration 0.08

describe('BuiltinSoundSystem', () => {
  test('PreToolUse Read plays A4 through a gain into dest', () => {
    const { oscs, dest } = play({ type: 'PreToolUse', tool: 'Read' })
    expect(oscs).toHaveLength(1)
    expect(oscs[0]).toMatchObject({ freq: 440, type: 'sine', start: 0 })
    expect(oscs[0].out.connected).toEqual([dest])
  })

  test('PostToolUse is one note higher', () => {
    expect(play({ type: 'PostToolUse', tool: 'Read' }).oscs[0].freq).toBe(493.88)
  })

  test('Stop plays a three-note chord staggered by 0.05s', () => {
    const { oscs } = play({ type: 'Stop' })
    expect(oscs.map((o) => o.freq)).toEqual([523.25, 659.25, 783.99])
    expect(oscs.map((o) => o.start)).toEqual([0, 0.05, 0.1])
    expect(oscs[2].stop).toBeCloseTo(0.1 + 0.6 + 0.1)
  })

  test('unknown event type falls back to tools.default', () => {
    const { oscs } = play({ type: 'Nope' })
    expect(oscs).toHaveLength(1)
    expect(oscs[0].freq).toBe(261.63)
  })

  test('invalid patches throw and keep the previous patch', () => {
    const sys = new BuiltinSoundSystem()
    const bad: unknown[] = [
      {},
      'bad',
      [],
      { tools: {} },
      { tools: { default: { duration: 'x' } } },
      { tools: { default: { duration: 0.1, gain: NaN } } },
      { tools: { default: { duration: 0.1, type: 'noise' } } },
      { tools: { default: { duration: 0.1 } }, Stop: { note: 'C4' } },
    ]
    for (const patch of bad) expect(() => sys.load(patch)).toThrow(TypeError)

    const { oscs, dest } = fakeContext()
    sys.createVoice(dest).trigger({ type: 'PreToolUse', tool: 'Read' })
    expect(oscs[0]).toMatchObject({ freq: 440, type: 'sine' })

    sys.load({ tools: { default: { note: 'C5', duration: 0.1 } } })
    sys.load(undefined)
    sys.createVoice(dest).trigger({ type: 'PreToolUse', tool: 'Read' })
    expect(oscs[1].freq).toBe(440)
  })

  test('exposes attack, length, octave, waveform', () => {
    expect(new BuiltinSoundSystem().params().map((p) => p.id)).toEqual(['attack', 'length', 'octave', 'waveform'])
  })

  test('octave: 1 doubles the frequency', () => {
    expect(play(read, { octave: 1 }).oscs[0].freq).toBe(880)
  })

  test("waveform: 'square' overrides the patch type; 'default' keeps it", () => {
    expect(play(read, { waveform: 'square' }).oscs[0].type).toBe('square')
    expect(play(read, { waveform: 'default' }).oscs[0].type).toBe('sine')
    expect(play(read, { waveform: 'banjo' }).oscs[0].type).toBe('sine')
  })

  test('length: 2 doubles the stop time offset', () => {
    const base = play(read).oscs[0].stop
    const long = play(read, { length: 2 }).oscs[0].stop
    expect(base).toBeCloseTo(0.08 + 0.1)
    expect(long).toBeCloseTo(0.16 + 0.1)
  })

  test('out-of-range values are clamped', () => {
    expect(play(read, { octave: 9 }).oscs[0].freq).toBe(440 * 4)
    expect(play(read, { octave: -9 }).oscs[0].freq).toBe(440 / 4)
    expect(play(read, { length: 100 }).oscs[0].stop).toBeCloseTo(0.08 * 3 + 0.1)
  })

  test('unknown ids are ignored', () => {
    expect(play(read, { nope: 3 }).oscs[0]).toMatchObject({ freq: 440, type: 'sine' })
  })
})
