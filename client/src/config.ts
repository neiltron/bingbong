import type { SoundConfigMap } from './types';

// WebSocket URL - use localhost in dev mode, location.host in production
export const WS_URL: string = import.meta.env.DEV
  ? 'ws://localhost:3334/ws'
  : `ws://${location.host}/ws`;

// Sound mappings - notes and characteristics for each event/tool
export const SOUND_CONFIG: SoundConfigMap = {
  // Event types
  SessionStart: {
    note: 'C4',
    duration: 0.4,
    type: 'sine',
    gain: 0.4,
  },
  SessionEnd: {
    note: 'G3',
    duration: 0.5,
    type: 'sine',
    gain: 0.3,
  },
  Stop: {
    notes: ['C5', 'E5', 'G5'],
    duration: 0.6,
    type: 'sine',
    gain: 0.5,
  },
  SubagentStop: {
    note: 'E5',
    duration: 0.3,
    type: 'triangle',
    gain: 0.35,
  },
  PreCompact: {
    note: 'D4',
    duration: 0.2,
    type: 'sawtooth',
    gain: 0.15,
  },

  // Tool-specific sounds (for PreToolUse/PostToolUse)
  tools: {
    Read: {
      note: 'A4',
      duration: 0.08,
      type: 'sine',
      gain: 0.15,
    },
    Write: {
      note: 'E4',
      duration: 0.12,
      type: 'triangle',
      gain: 0.25,
    },
    Edit: {
      note: 'D4',
      duration: 0.1,
      type: 'triangle',
      gain: 0.2,
    },
    Bash: {
      note: 'F3',
      duration: 0.15,
      type: 'square',
      gain: 0.12,
    },
    Task: {
      notes: ['G4', 'B4'],
      duration: 0.25,
      type: 'sine',
      gain: 0.35,
    },
    Grep: {
      note: 'B4',
      duration: 0.06,
      type: 'sine',
      gain: 0.1,
    },
    Glob: {
      note: 'C5',
      duration: 0.06,
      type: 'sine',
      gain: 0.1,
    },
    WebFetch: {
      note: 'F#4',
      duration: 0.15,
      type: 'sine',
      gain: 0.2,
    },
    WebSearch: {
      note: 'G#4',
      duration: 0.2,
      type: 'sine',
      gain: 0.25,
    },
    TodoWrite: {
      note: 'A3',
      duration: 0.1,
      type: 'triangle',
      gain: 0.15,
    },
    default: {
      note: 'C4',
      duration: 0.1,
      type: 'sine',
      gain: 0.15,
    },
  },
};

// Note to frequency mapping
export const NOTE_FREQ: Record<string, number> = {
  C3: 130.81,
  D3: 146.83,
  E3: 164.81,
  F3: 174.61,
  'F#3': 185.0,
  G3: 196.0,
  'G#3': 207.65,
  A3: 220.0,
  B3: 246.94,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  'F#4': 369.99,
  G4: 392.0,
  'G#4': 415.3,
  A4: 440.0,
  B4: 493.88,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  F5: 698.46,
  G5: 783.99,
  A5: 880.0,
  B5: 987.77,
};

// Maximum number of events to keep in log
export const MAX_LOG_ITEMS = 50;
