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

function play(event: { type: string; tool?: string }) {
  const { oscs, dest } = fakeContext()
  new BuiltinSoundSystem().createVoice(dest).trigger(event)
  return { oscs, dest }
}

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
})
