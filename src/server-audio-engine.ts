import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import {
  applyAudioConfigPatch,
  createDefaultAudioConfigSnapshot,
  type AudioConfigPatch,
  type AudioConfigSnapshot,
  type SessionPosition,
} from "./audio-protocol";

type OscillatorShape = "sine" | "triangle" | "square" | "sawtooth";

interface SoundParams {
  note?: string;
  notes?: string[];
  duration: number;
  type: OscillatorShape;
  gain: number;
}

interface SoundConfig {
  [eventType: string]: SoundParams | Record<string, SoundParams>;
  tools: Record<string, SoundParams>;
}

interface EnrichedEventForAudio {
  event_type: string;
  tool_name: string;
  pan: number;
  machine_id: string;
  session_id: string;
}

interface PlayerBackend {
  command: string;
  argsForFile: (filePath: string) => string[];
}

const SOUND_CONFIG: SoundConfig = {
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

const NOTE_FREQUENCY: Record<string, number> = {
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

const NOTE_SEQUENCE = Object.keys(NOTE_FREQUENCY);
const SAMPLE_RATE = 44_100;
const MAX_CONCURRENT_CLIPS = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toSessionKey(machineId: string, sessionId: string): string | null {
  if (!machineId || !sessionId) return null;
  return `${machineId}:${sessionId}`;
}

function commandExists(command: string): boolean {
  const check =
    process.platform === "win32"
      ? Bun.spawnSync(["where", command], {
          stdout: "ignore",
          stderr: "ignore",
        })
      : Bun.spawnSync(["/bin/sh", "-lc", `command -v ${command}`], {
          stdout: "ignore",
          stderr: "ignore",
        });

  return check.exitCode === 0;
}

function detectPlayerBackend(): PlayerBackend | null {
  if (process.platform === "darwin" && commandExists("afplay")) {
    return {
      command: "afplay",
      argsForFile: (filePath) => [filePath],
    };
  }

  if (process.platform === "linux" && commandExists("aplay")) {
    return {
      command: "aplay",
      argsForFile: (filePath) => ["-q", filePath],
    };
  }

  if (process.platform === "win32" && commandExists("powershell")) {
    return {
      command: "powershell",
      argsForFile: (filePath) => [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(New-Object Media.SoundPlayer '${filePath}').PlaySync()`,
      ],
    };
  }

  return null;
}

function normalizePosition(position: SessionPosition): SessionPosition {
  return {
    x: clamp(position.x, 0, 1),
    y: clamp(position.y, 0, 1),
  };
}

function waveformSample(shape: OscillatorShape, phase: number): number {
  switch (shape) {
    case "square":
      return Math.sin(phase) >= 0 ? 1 : -1;
    case "triangle":
      return (2 / Math.PI) * Math.asin(Math.sin(phase));
    case "sawtooth": {
      const normalized = (phase / (2 * Math.PI)) % 1;
      return 2 * (normalized < 0 ? normalized + 1 : normalized) - 1;
    }
    case "sine":
    default:
      return Math.sin(phase);
  }
}

function encodeStereoWav(left: Float32Array, right: Float32Array, sampleRate: number): Uint8Array {
  const frameCount = Math.min(left.length, right.length);
  const channelCount = 2;
  const bitsPerSample = 16;
  const blockAlign = (channelCount * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = frameCount * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  let offset = 0;
  const writeString = (value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
    offset += value.length;
  };

  writeString("RIFF");
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  writeString("WAVE");
  writeString("fmt ");
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, channelCount, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, byteRate, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, bitsPerSample, true);
  offset += 2;
  writeString("data");
  view.setUint32(offset, dataSize, true);
  offset += 4;

  for (let i = 0; i < frameCount; i++) {
    const leftSample = clamp(left[i] || 0, -1, 1);
    const rightSample = clamp(right[i] || 0, -1, 1);
    view.setInt16(offset, Math.round(leftSample * 32_767), true);
    offset += 2;
    view.setInt16(offset, Math.round(rightSample * 32_767), true);
    offset += 2;
  }

  return bytes;
}

export class ServerAudioEngine {
  private enabled = false;
  private backend: PlayerBackend | null = null;
  private tmpDir: string | null = null;
  private activePlayback = 0;
  private droppedClips = 0;
  private config: AudioConfigSnapshot = createDefaultAudioConfigSnapshot();

  async init(): Promise<void> {
    if ((process.env.BINGBONG_SERVER_AUDIO || "true").toLowerCase() === "false") {
      console.log("[Audio] Server audio disabled via BINGBONG_SERVER_AUDIO=false");
      return;
    }

    this.backend = detectPlayerBackend();
    if (!this.backend) {
      console.log("[Audio] No supported system player found (afplay/aplay/powershell). Audio disabled.");
      return;
    }

    this.tmpDir = await mkdtemp(path.join(os.tmpdir(), "bingbong-audio-"));
    this.enabled = true;
    console.log(`[Audio] Server audio enabled (${this.backend.command})`);
  }

  async stop(): Promise<void> {
    this.enabled = false;
    if (this.tmpDir) {
      await rm(this.tmpDir, { recursive: true, force: true });
      this.tmpDir = null;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getConfigSnapshot(): AudioConfigSnapshot {
    return {
      global: { ...this.config.global },
      session_positions: { ...this.config.session_positions },
    };
  }

  replaceConfig(snapshot: AudioConfigSnapshot): void {
    this.config = {
      global: { ...snapshot.global },
      session_positions: { ...snapshot.session_positions },
    };
  }

  patchConfig(patch: AudioConfigPatch): void {
    this.config = applyAudioConfigPatch(this.config, patch);
  }

  removeSession(sessionKey: string): void {
    if (!this.config.session_positions[sessionKey]) return;
    this.config = applyAudioConfigPatch(this.config, {
      session_positions: {
        [sessionKey]: null,
      },
    });
  }

  playEvent(event: EnrichedEventForAudio): void {
    if (!this.enabled || !this.backend || !this.tmpDir || this.config.global.muted) {
      return;
    }

    const config = this.resolveSoundConfig(event);
    const sessionKey = toSessionKey(event.machine_id, event.session_id);
    const position = this.resolveSessionPosition(sessionKey, event.pan);
    const wav = this.renderClip(config, position);
    void this.playWav(wav);
  }

  private resolveSessionPosition(sessionKey: string | null, fallbackPan: number): SessionPosition {
    if (sessionKey) {
      const existing = this.config.session_positions[sessionKey];
      if (existing) return normalizePosition(existing);

      const fallback = {
        x: clamp(0.5 + fallbackPan * 0.5, 0.05, 0.95),
        y: 0.5,
      };
      this.config.session_positions[sessionKey] = fallback;
      return fallback;
    }

    return {
      x: clamp(0.5 + fallbackPan * 0.5, 0.05, 0.95),
      y: 0.5,
    };
  }

  private resolveSoundConfig(event: EnrichedEventForAudio): SoundParams {
    const { event_type, tool_name } = event;
    const tools = SOUND_CONFIG.tools;

    if (event_type === "PreToolUse" || event_type === "PostToolUse") {
      const base = tools[tool_name] || tools.default;
      if (event_type !== "PostToolUse" || !base.note) return { ...base };

      const index = NOTE_SEQUENCE.indexOf(base.note);
      if (index >= 0 && index < NOTE_SEQUENCE.length - 1) {
        return {
          ...base,
          note: NOTE_SEQUENCE[index + 1],
        };
      }

      return { ...base };
    }

    const mapped = SOUND_CONFIG[event_type];
    if (mapped && "duration" in mapped) {
      return { ...mapped };
    }

    return { ...tools.default };
  }

  private renderClip(config: SoundParams, position: SessionPosition): Uint8Array {
    const notes = config.notes || (config.note ? [config.note] : ["C4"]);
    const totalDuration = Math.max(0.1, config.duration) + (notes.length - 1) * 0.05 + 0.4;
    const frameCount = Math.ceil(totalDuration * SAMPLE_RATE);
    const mono = new Float32Array(frameCount);

    notes.forEach((note, noteIndex) => {
      const frequency = NOTE_FREQUENCY[note] || 440;
      const startAt = noteIndex * 0.05;
      this.renderNote(mono, {
        frequency,
        duration: Math.max(0.06, config.duration),
        gain: (config.gain || 0.15) / Math.max(1, notes.length),
        shape: config.type || "sine",
        startAt,
      });
    });

    const wet = this.applySimpleReverb(mono, this.config.global.reverb);
    const panned = this.panStereo(wet, position, this.config.global.volume);
    return encodeStereoWav(panned.left, panned.right, SAMPLE_RATE);
  }

  private renderNote(
    destination: Float32Array,
    args: {
      frequency: number;
      duration: number;
      gain: number;
      shape: OscillatorShape;
      startAt: number;
    }
  ): void {
    const startIndex = Math.max(0, Math.floor(args.startAt * SAMPLE_RATE));
    const noteLengthSeconds = args.duration + 0.12;
    const noteFrames = Math.floor(noteLengthSeconds * SAMPLE_RATE);
    const attackSeconds = Math.min(0.02, args.duration * 0.25);
    const decaySeconds = Math.max(0.04, args.duration * 0.75);

    for (let i = 0; i < noteFrames; i++) {
      const frame = startIndex + i;
      if (frame >= destination.length) break;

      const t = i / SAMPLE_RATE;
      const phase = 2 * Math.PI * args.frequency * t;
      const raw = waveformSample(args.shape, phase);
      const envelope =
        t < attackSeconds
          ? t / Math.max(attackSeconds, 0.001)
          : Math.exp(-(t - attackSeconds) / Math.max(decaySeconds, 0.001));

      destination[frame] += raw * envelope * args.gain;
    }
  }

  private applySimpleReverb(input: Float32Array, amount: number): Float32Array {
    const wet = new Float32Array(input.length);
    const delays = [0.0297, 0.0431, 0.071];
    const gains = [0.58, 0.43, 0.31];

    for (let i = 0; i < input.length; i++) {
      wet[i] += input[i];
      for (let tap = 0; tap < delays.length; tap++) {
        const delayedIndex = i + Math.floor(delays[tap] * SAMPLE_RATE);
        if (delayedIndex >= wet.length) continue;
        const tail = 1 - i / input.length;
        wet[delayedIndex] += input[i] * amount * gains[tap] * tail;
      }
    }

    return wet;
  }

  private panStereo(
    mono: Float32Array,
    position: SessionPosition,
    volume: number
  ): { left: Float32Array; right: Float32Array } {
    const left = new Float32Array(mono.length);
    const right = new Float32Array(mono.length);
    const normalized = normalizePosition(position);

    const pan = clamp((normalized.x - 0.5) * 2, -1, 1);
    const theta = ((pan + 1) * Math.PI) / 4;
    const leftGain = Math.cos(theta);
    const rightGain = Math.sin(theta);

    const distanceFromCenter = Math.hypot(normalized.x - 0.5, normalized.y - 0.5) / 0.7071;
    const distanceAttenuation = clamp(1 - distanceFromCenter * 0.45, 0.5, 1);
    const frontBoost = clamp(1 + (0.5 - normalized.y) * 0.15, 0.85, 1.15);
    const master = clamp(volume, 0, 1) * distanceAttenuation * frontBoost;

    for (let i = 0; i < mono.length; i++) {
      const sample = mono[i] * master;
      left[i] = sample * leftGain;
      right[i] = sample * rightGain;
    }

    return { left, right };
  }

  private async playWav(wav: Uint8Array): Promise<void> {
    if (!this.enabled || !this.backend || !this.tmpDir) return;

    if (this.activePlayback >= MAX_CONCURRENT_CLIPS) {
      this.droppedClips += 1;
      if (this.droppedClips % 50 === 1) {
        console.warn(
          `[Audio] Dropping clips under heavy load (dropped=${this.droppedClips}, active=${this.activePlayback})`
        );
      }
      return;
    }

    const filePath = path.join(
      this.tmpDir,
      `clip-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`
    );

    try {
      await Bun.write(filePath, wav);
      this.activePlayback += 1;

      const process = Bun.spawn([this.backend.command, ...this.backend.argsForFile(filePath)], {
        stdout: "ignore",
        stderr: "ignore",
      });

      process.exited
        .catch(() => undefined)
        .finally(async () => {
          this.activePlayback = Math.max(0, this.activePlayback - 1);
          await unlink(filePath).catch(() => undefined);
        });
    } catch (error) {
      console.warn(`[Audio] Failed to play clip: ${error}`);
      this.activePlayback = Math.max(0, this.activePlayback - 1);
      await unlink(filePath).catch(() => undefined);
    }
  }
}
