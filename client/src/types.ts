export interface SoundConfig {
  note?: string;
  notes?: string[];
  duration: number;
  type: OscillatorType;
  gain: number;
}

export interface ToolSoundConfigs {
  [key: string]: SoundConfig;
  default: SoundConfig;
}

export interface SoundConfigMap {
  SessionStart: SoundConfig;
  SessionEnd: SoundConfig;
  Stop: SoundConfig;
  SubagentStop: SoundConfig;
  PreCompact: SoundConfig;
  tools: ToolSoundConfigs;
  [key: string]: SoundConfig | ToolSoundConfigs;
}

export interface Session {
  session_id: string;
  machine_id: string;
  pan: number;
  color: string;
  event_count: number;
}

export interface BingbongEvent {
  event_type: string;
  session_id: string;
  machine_id: string;
  timestamp: string;
  tool_name?: string;
  pan?: number;
  session_index?: number;
  color?: string;
}

export interface InitMessage {
  type: 'init';
  sessions: Session[];
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  lifetime: number;
  maxLifetime: number;
}

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}
