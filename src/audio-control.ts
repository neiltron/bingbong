export interface GlobalAudioConfig {
  volume: number;
  reverb: number;
  muted: boolean;
}

export interface SessionPosition {
  x: number;
  y: number;
}

export interface AudioConfigUpdateMessage {
  type: "audio_config:update";
  config: Partial<GlobalAudioConfig>;
}

export interface SessionConfigUpdateMessage {
  type: "session_config:update";
  session_key: string;
  position: SessionPosition;
}

export type ClientAudioControlMessage = AudioConfigUpdateMessage | SessionConfigUpdateMessage;

export const DEFAULT_GLOBAL_AUDIO_CONFIG: GlobalAudioConfig = {
  volume: 0.7,
  reverb: 0.3,
  muted: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function sanitizeGlobalAudioConfigPatch(
  config: Partial<GlobalAudioConfig>
): Partial<GlobalAudioConfig> {
  const sanitized: Partial<GlobalAudioConfig> = {};

  if (typeof config.volume === "number") {
    sanitized.volume = clampUnit(config.volume);
  }

  if (typeof config.reverb === "number") {
    sanitized.reverb = clampUnit(config.reverb);
  }

  if (typeof config.muted === "boolean") {
    sanitized.muted = config.muted;
  }

  return sanitized;
}

export function sanitizeSessionPosition(position: SessionPosition): SessionPosition {
  return {
    x: clampUnit(position.x),
    y: clampUnit(position.y),
  };
}

export function parseClientAudioControlMessage(value: unknown): ClientAudioControlMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  if (value.type === "audio_config:update") {
    if (!isRecord(value.config)) {
      return null;
    }

    const sanitized = sanitizeGlobalAudioConfigPatch(value.config as Partial<GlobalAudioConfig>);
    if (Object.keys(sanitized).length === 0) {
      return null;
    }

    return {
      type: "audio_config:update",
      config: sanitized,
    };
  }

  if (value.type === "session_config:update") {
    if (typeof value.session_key !== "string" || value.session_key.length === 0) {
      return null;
    }

    if (!isRecord(value.position)) {
      return null;
    }

    const { x, y } = value.position;
    if (typeof x !== "number" || typeof y !== "number") {
      return null;
    }

    return {
      type: "session_config:update",
      session_key: value.session_key,
      position: sanitizeSessionPosition({ x, y }),
    };
  }

  return null;
}
