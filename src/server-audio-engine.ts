import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_GLOBAL_AUDIO_CONFIG,
  type GlobalAudioConfig,
  type SessionPosition,
} from "./audio-control";

export type Waveform = "sine" | "triangle" | "square" | "sawtooth";

export interface SoundPreset {
  note?: string;
  notes?: string[];
  duration: number;
  type: Waveform;
  gain: number;
}

export interface AudioEventEnvelope {
  event_type: string;
  tool_name?: string;
  pan?: number;
  machine_id?: string;
  session_id?: string;
}

interface PlaybackSpec {
  notes: string[];
  waveform: Waveform;
  durationSeconds: number;
  gain: number;
  pan: number;
  reverbAmount: number;
  distanceAttenuation: number;
}

interface AudioPlayer {
  readonly command: string | null;
  play(filePath: string): Promise<void>;
}

export interface AudioEngineStatus {
  enabled: boolean;
  reason: string | null;
  player: string | null;
}

const SOUND_CONFIG: Record<string, SoundPreset | Record<string, SoundPreset>> = {
  SessionStart: {
    note: "C4",
    duration: 0.4,
    type: "sine",
    gain: 0.4,
  },
  SessionEnd: {
    note: "G3",
    duration: 0.5,
    type: "sine",
    gain: 0.3,
  },
  Stop: {
    notes: ["C5", "E5", "G5"],
    duration: 0.6,
    type: "sine",
    gain: 0.5,
  },
  SubagentStop: {
    note: "E5",
    duration: 0.3,
    type: "triangle",
    gain: 0.35,
  },
  PreCompact: {
    note: "D4",
    duration: 0.2,
    type: "sawtooth",
    gain: 0.15,
  },
  tools: {
    Read: {
      note: "A4",
      duration: 0.08,
      type: "sine",
      gain: 0.15,
    },
    Write: {
      note: "E4",
      duration: 0.12,
      type: "triangle",
      gain: 0.25,
    },
    Edit: {
      note: "D4",
      duration: 0.1,
      type: "triangle",
      gain: 0.2,
    },
    Bash: {
      note: "F3",
      duration: 0.15,
      type: "square",
      gain: 0.12,
    },
    Task: {
      notes: ["G4", "B4"],
      duration: 0.25,
      type: "sine",
      gain: 0.35,
    },
    Grep: {
      note: "B4",
      duration: 0.06,
      type: "sine",
      gain: 0.1,
    },
    Glob: {
      note: "C5",
      duration: 0.06,
      type: "sine",
      gain: 0.1,
    },
    WebFetch: {
      note: "F#4",
      duration: 0.15,
      type: "sine",
      gain: 0.2,
    },
    WebSearch: {
      note: "G#4",
      duration: 0.2,
      type: "sine",
      gain: 0.25,
    },
    TodoWrite: {
      note: "A3",
      duration: 0.1,
      type: "triangle",
      gain: 0.15,
    },
    default: {
      note: "C4",
      duration: 0.1,
      type: "sine",
      gain: 0.15,
    },
  },
};

const NOTE_FREQ: Record<string, number> = {
  C3: 130.81,
  D3: 146.83,
  E3: 164.81,
  F3: 174.61,
  "F#3": 185.0,
  G3: 196.0,
  "G#3": 207.65,
  A3: 220.0,
  B3: 246.94,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  "F#4": 369.99,
  G4: 392.0,
  "G#4": 415.3,
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

function clampSample(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function clampPan(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function pickSoundPreset(event: AudioEventEnvelope): SoundPreset {
  if (event.event_type === "PreToolUse" || event.event_type === "PostToolUse") {
    const tools = SOUND_CONFIG.tools as Record<string, SoundPreset>;
    let preset = tools[event.tool_name ?? ""] || tools.default;

    if (event.event_type === "PostToolUse" && preset.note) {
      const notes = Object.keys(NOTE_FREQ);
      const idx = notes.indexOf(preset.note);
      if (idx >= 0 && idx < notes.length - 1) {
        preset = {
          ...preset,
          note: notes[idx + 1],
        };
      }
    }

    return preset;
  }

  const direct = SOUND_CONFIG[event.event_type];
  if (direct && "duration" in direct) {
    return direct as SoundPreset;
  }

  const tools = SOUND_CONFIG.tools as Record<string, SoundPreset>;
  return tools.default;
}

function waveSample(waveform: Waveform, frequency: number, t: number): number {
  const phase = 2 * Math.PI * frequency * t;

  switch (waveform) {
    case "triangle":
      return (2 / Math.PI) * Math.asin(Math.sin(phase));
    case "square":
      return Math.sin(phase) >= 0 ? 1 : -1;
    case "sawtooth": {
      const cycle = (frequency * t) % 1;
      return 2 * cycle - 1;
    }
    default:
      return Math.sin(phase);
  }
}

export function positionToPan(position: SessionPosition): number {
  return clampPan(position.x * 2 - 1);
}

export function positionToDistanceAttenuation(position: SessionPosition): number {
  const dx = position.x - 0.5;
  const dy = position.y - 0.5;
  const normalizedDistance = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 0.7071);
  return 1 - normalizedDistance * 0.55;
}

export function synthesizeStereoWav(playback: PlaybackSpec, masterVolume: number): Uint8Array {
  const sampleRate = 44_100;
  const attackSeconds = 0.01;
  const noteGapSeconds = 0.05;
  const tailSeconds = 0.18 + playback.reverbAmount * 0.25;
  const durationSeconds = playback.durationSeconds + tailSeconds;
  const totalFrames = Math.max(1, Math.floor(durationSeconds * sampleRate));

  const mono = new Float32Array(totalFrames);
  const attackFrames = Math.max(1, Math.floor(attackSeconds * sampleRate));

  playback.notes.forEach((note, noteIndex) => {
    const frequency = NOTE_FREQ[note] ?? 440;
    const offsetFrames = Math.floor(noteIndex * noteGapSeconds * sampleRate);
    const noteFrames = Math.max(1, Math.floor(playback.durationSeconds * sampleRate));

    for (let frame = 0; frame < noteFrames; frame++) {
      const target = offsetFrames + frame;
      if (target >= totalFrames) break;

      const t = frame / sampleRate;
      const osc = waveSample(playback.waveform, frequency, t);
      const attack = frame < attackFrames ? frame / attackFrames : 1;
      const decay = Math.exp((-5 * frame) / noteFrames);
      mono[target] += osc * attack * decay * playback.gain;
    }
  });

  // Simple wet tail for exploratory reverb support.
  const delayFrames = Math.floor(sampleRate * 0.085);
  if (playback.reverbAmount > 0 && delayFrames > 0) {
    const wet1 = playback.reverbAmount * 0.32;
    const wet2 = playback.reverbAmount * 0.14;

    for (let frame = delayFrames; frame < totalFrames; frame++) {
      mono[frame] += mono[frame - delayFrames] * wet1;
      if (frame - delayFrames * 2 >= 0) {
        mono[frame] += mono[frame - delayFrames * 2] * wet2;
      }
    }
  }

  const pan = clampPan(playback.pan);
  const theta = ((pan + 1) * Math.PI) / 4;
  const leftGain = Math.cos(theta);
  const rightGain = Math.sin(theta);

  const finalGain = Math.max(0, masterVolume) * playback.distanceAttenuation;

  const pcmBytes = totalFrames * 2 * 2;
  const wavBuffer = new ArrayBuffer(44 + pcmBytes);
  const view = new DataView(wavBuffer);

  view.setUint32(0, 0x52494646, false); // RIFF
  view.setUint32(4, 36 + pcmBytes, true);
  view.setUint32(8, 0x57415645, false); // WAVE
  view.setUint32(12, 0x666d7420, false); // fmt
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 2, true); // stereo
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2 * 2, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461, false); // data
  view.setUint32(40, pcmBytes, true);

  let offset = 44;
  for (let frame = 0; frame < totalFrames; frame++) {
    const sample = clampSample(mono[frame] * finalGain);
    const left = clampSample(sample * leftGain);
    const right = clampSample(sample * rightGain);

    view.setInt16(offset, Math.round(left * 32767), true);
    offset += 2;
    view.setInt16(offset, Math.round(right * 32767), true);
    offset += 2;
  }

  return new Uint8Array(wavBuffer);
}

class CommandLineAudioPlayer implements AudioPlayer {
  readonly command: string | null;

  constructor() {
    this.command = Bun.which("afplay") ?? Bun.which("ffplay") ?? Bun.which("aplay") ?? null;
  }

  async play(filePath: string): Promise<void> {
    if (!this.command) return;

    const commandName = this.command.split("/").pop() ?? this.command;
    const args =
      commandName === "ffplay"
        ? [this.command, "-nodisp", "-autoexit", "-loglevel", "quiet", filePath]
        : [this.command, filePath];

    const proc = Bun.spawn(args, {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });

    await proc.exited;
  }
}

export class ServerAudioEngine {
  private readonly player: AudioPlayer;
  private readonly globalConfig: GlobalAudioConfig = { ...DEFAULT_GLOBAL_AUDIO_CONFIG };
  private readonly sessionPositions = new Map<string, SessionPosition>();
  private readonly queueLimit = 32;
  private queueDepth = 0;
  private playbackQueue: Promise<void> = Promise.resolve();

  constructor(player: AudioPlayer = new CommandLineAudioPlayer()) {
    this.player = player;
  }

  getStatus(): AudioEngineStatus {
    if (!this.player.command) {
      return {
        enabled: false,
        reason: "No system audio command found (afplay/ffplay/aplay)",
        player: null,
      };
    }

    return {
      enabled: true,
      reason: null,
      player: this.player.command,
    };
  }

  getGlobalConfig(): GlobalAudioConfig {
    return { ...this.globalConfig };
  }

  getSessionPositions(): Record<string, SessionPosition> {
    return Object.fromEntries(this.sessionPositions.entries());
  }

  applyGlobalConfigPatch(config: Partial<GlobalAudioConfig>): void {
    if (typeof config.volume === "number") {
      this.globalConfig.volume = Math.max(0, Math.min(1, config.volume));
    }

    if (typeof config.reverb === "number") {
      this.globalConfig.reverb = Math.max(0, Math.min(1, config.reverb));
    }

    if (typeof config.muted === "boolean") {
      this.globalConfig.muted = config.muted;
    }
  }

  upsertSessionPosition(sessionKey: string, position: SessionPosition): void {
    this.sessionPositions.set(sessionKey, {
      x: Math.max(0, Math.min(1, position.x)),
      y: Math.max(0, Math.min(1, position.y)),
    });
  }

  removeSessionPosition(sessionKey: string): void {
    this.sessionPositions.delete(sessionKey);
  }

  playEvent(event: AudioEventEnvelope): void {
    if (this.globalConfig.muted) return;
    if (!this.player.command) return;

    const preset = pickSoundPreset(event);
    const notes = preset.notes || (preset.note ? [preset.note] : []);
    if (notes.length === 0) return;

    const sessionKey =
      event.machine_id && event.session_id ? `${event.machine_id}:${event.session_id}` : null;

    const position = sessionKey ? this.sessionPositions.get(sessionKey) : undefined;
    const pan = position ? positionToPan(position) : clampPan(event.pan ?? 0);
    const distanceAttenuation = position ? positionToDistanceAttenuation(position) : 1;

    const playback: PlaybackSpec = {
      notes,
      waveform: preset.type,
      durationSeconds: preset.duration,
      gain: preset.gain,
      pan,
      reverbAmount: this.globalConfig.reverb,
      distanceAttenuation,
    };

    if (this.queueDepth >= this.queueLimit) {
      return;
    }

    this.queueDepth++;
    this.playbackQueue = this.playbackQueue
      .then(async () => {
        const wav = synthesizeStereoWav(playback, this.globalConfig.volume);
        const tmpPath = join(tmpdir(), `bingbong-${randomUUID()}.wav`);

        await writeFile(tmpPath, wav);
        try {
          await this.player.play(tmpPath);
        } finally {
          await rm(tmpPath, { force: true });
        }
      })
      .catch((error) => {
        console.error("[Audio] Playback failed:", error);
      })
      .finally(() => {
        this.queueDepth = Math.max(0, this.queueDepth - 1);
      });
  }
}
