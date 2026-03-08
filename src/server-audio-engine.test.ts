import { describe, expect, test } from 'bun:test'
import {
  positionToDistanceAttenuation,
  positionToPan,
  synthesizeStereoWav,
} from './server-audio-engine'

describe('server audio synthesis helpers', () => {
  test('maps normalized x position to stereo pan', () => {
    expect(positionToPan({ x: 0, y: 0.5 })).toBe(-1)
    expect(positionToPan({ x: 0.5, y: 0.5 })).toBe(0)
    expect(positionToPan({ x: 1, y: 0.5 })).toBe(1)
  })

  test('attenuates distant sources more than centered ones', () => {
    const center = positionToDistanceAttenuation({ x: 0.5, y: 0.5 })
    const edge = positionToDistanceAttenuation({ x: 0, y: 0 })

    expect(center).toBeGreaterThan(edge)
    expect(center).toBeCloseTo(1, 4)
  })

  test('produces a valid wav payload', () => {
    const wav = synthesizeStereoWav(
      {
        notes: ['C4', 'E4', 'G4'],
        waveform: 'sine',
        durationSeconds: 0.2,
        gain: 0.2,
        pan: 0,
        reverbAmount: 0.3,
        distanceAttenuation: 1,
      },
      0.7
    )

    // RIFF + WAVE headers
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE')
    expect(wav.length).toBeGreaterThan(44)
  })
})
