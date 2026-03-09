export const AUDIO_CONFIG_PROTOCOL_VERSION = 1 as const;

export interface AudioGlobalConfig {
  volume: number;
  reverb: number;
  muted: boolean;
}

export interface SessionPosition {
  x: number;
  y: number;
}

export interface AudioConfigSnapshot {
  global: AudioGlobalConfig;
  session_positions: Record<string, SessionPosition>;
}

export interface AudioConfigPatch {
  global?: Partial<AudioGlobalConfig>;
  session_positions?: Record<string, SessionPosition | null>;
}

export interface AudioConfigReplaceMessage {
  type: "audio_config.replace";
  version: typeof AUDIO_CONFIG_PROTOCOL_VERSION;
  payload: AudioConfigSnapshot;
}

export interface AudioConfigPatchMessage {
  type: "audio_config.patch";
  version: typeof AUDIO_CONFIG_PROTOCOL_VERSION;
  payload: AudioConfigPatch;
}

export type ClientAudioConfigMessage = AudioConfigReplaceMessage | AudioConfigPatchMessage;

export const DEFAULT_AUDIO_GLOBAL: AudioGlobalConfig = {
  volume: 0.7,
  reverb: 0.3,
  muted: false,
};

export type ParsedAudioConfigMessage =
  | { type: "replace"; payload: AudioConfigSnapshot }
  | { type: "patch"; payload: AudioConfigPatch };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp01(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function normalizeSessionPosition(value: unknown): SessionPosition | null {
  if (!isRecord(value)) return null;

  return {
    x: clamp01(value.x, 0.5),
    y: clamp01(value.y, 0.5),
  };
}

function normalizeGlobalConfig(value: unknown, fallback: AudioGlobalConfig): AudioGlobalConfig {
  if (!isRecord(value)) return { ...fallback };

  return {
    volume: clamp01(value.volume, fallback.volume),
    reverb: clamp01(value.reverb, fallback.reverb),
    muted: "muted" in value ? Boolean(value.muted) : fallback.muted,
  };
}

function normalizeGlobalPatch(value: unknown): Partial<AudioGlobalConfig> | null {
  if (!isRecord(value)) return null;

  const patch: Partial<AudioGlobalConfig> = {};
  if ("volume" in value) patch.volume = clamp01(value.volume, DEFAULT_AUDIO_GLOBAL.volume);
  if ("reverb" in value) patch.reverb = clamp01(value.reverb, DEFAULT_AUDIO_GLOBAL.reverb);
  if ("muted" in value) patch.muted = Boolean(value.muted);

  return Object.keys(patch).length > 0 ? patch : null;
}

function normalizeSessionPositionPatch(
  value: unknown
): Record<string, SessionPosition | null> | null {
  if (!isRecord(value)) return null;

  const positions: Record<string, SessionPosition | null> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!key) continue;
    if (candidate === null) {
      positions[key] = null;
      continue;
    }

    const normalized = normalizeSessionPosition(candidate);
    if (!normalized) continue;
    positions[key] = normalized;
  }

  return Object.keys(positions).length > 0 ? positions : null;
}

function normalizeSessionPositionSnapshot(value: unknown): Record<string, SessionPosition> {
  if (!isRecord(value)) return {};

  const positions: Record<string, SessionPosition> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!key) continue;
    const normalized = normalizeSessionPosition(candidate);
    if (!normalized) continue;
    positions[key] = normalized;
  }

  return positions;
}

export function createDefaultAudioConfigSnapshot(): AudioConfigSnapshot {
  return {
    global: { ...DEFAULT_AUDIO_GLOBAL },
    session_positions: {},
  };
}

export function applyAudioConfigPatch(
  snapshot: AudioConfigSnapshot,
  patch: AudioConfigPatch
): AudioConfigSnapshot {
  const next: AudioConfigSnapshot = {
    global: { ...snapshot.global, ...(patch.global || {}) },
    session_positions: { ...snapshot.session_positions },
  };

  if (patch.session_positions) {
    for (const [key, position] of Object.entries(patch.session_positions)) {
      if (position === null) {
        delete next.session_positions[key];
      } else {
        next.session_positions[key] = position;
      }
    }
  }

  return next;
}

export function parseClientAudioConfigMessage(rawMessage: string): ParsedAudioConfigMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  if (parsed.version !== AUDIO_CONFIG_PROTOCOL_VERSION) return null;

  if (parsed.type === "audio_config.replace") {
    const payload = parsed.payload;
    if (!isRecord(payload)) return null;

    const snapshot: AudioConfigSnapshot = {
      global: normalizeGlobalConfig(payload.global, DEFAULT_AUDIO_GLOBAL),
      session_positions: normalizeSessionPositionSnapshot(payload.session_positions),
    };

    return {
      type: "replace",
      payload: snapshot,
    };
  }

  if (parsed.type === "audio_config.patch") {
    const payload = parsed.payload;
    if (!isRecord(payload)) return null;

    const patch: AudioConfigPatch = {};
    const globalPatch = normalizeGlobalPatch(payload.global);
    const positionPatch = normalizeSessionPositionPatch(payload.session_positions);

    if (globalPatch) patch.global = globalPatch;
    if (positionPatch) patch.session_positions = positionPatch;
    if (Object.keys(patch).length === 0) return null;

    return {
      type: "patch",
      payload: patch,
    };
  }

  return null;
}
