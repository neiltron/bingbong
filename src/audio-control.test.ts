import { describe, expect, test } from 'bun:test'
import { parseClientAudioControlMessage } from './audio-control'

describe('parseClientAudioControlMessage', () => {
  test('accepts and clamps global audio config patches', () => {
    const parsed = parseClientAudioControlMessage({
      type: 'audio_config:update',
      config: {
        volume: 1.8,
        reverb: -0.2,
        muted: true,
      },
    })

    expect(parsed).toEqual({
      type: 'audio_config:update',
      config: {
        volume: 1,
        reverb: 0,
        muted: true,
      },
    })
  })

  test('rejects empty global config patches', () => {
    const parsed = parseClientAudioControlMessage({
      type: 'audio_config:update',
      config: { unsupported: 1 },
    })

    expect(parsed).toBeNull()
  })

  test('accepts and clamps session position updates', () => {
    const parsed = parseClientAudioControlMessage({
      type: 'session_config:update',
      session_key: 'machine:session',
      position: { x: 1.4, y: -0.3 },
    })

    expect(parsed).toEqual({
      type: 'session_config:update',
      session_key: 'machine:session',
      position: { x: 1, y: 0 },
    })
  })

  test('rejects malformed messages', () => {
    expect(parseClientAudioControlMessage({ type: 'nope' })).toBeNull()
    expect(parseClientAudioControlMessage({ type: 'session_config:update', session_key: 123 })).toBeNull()
    expect(parseClientAudioControlMessage(null)).toBeNull()
  })
})
