// Types matching server definitions in src/server.ts

export interface BingbongEvent {
  event_type: string
  session_id: string
  machine_id: string
  timestamp: string
  cwd: string
  tool_name: string
  tool_input: Record<string, unknown>
  tool_output: Record<string, unknown>
}

export interface EnrichedEvent extends BingbongEvent {
  pan: number // -1 (left) to 1 (right)
  session_index: number
  color: string
}

export interface GlobalAudioConfig {
  volume: number
  reverb: number
  muted: boolean
}

export interface SessionPosition {
  x: number
  y: number
}

export interface AudioConfigUpdateMessage {
  type: 'audio_config:update'
  config: Partial<GlobalAudioConfig>
}

export interface SessionConfigUpdateMessage {
  type: 'session_config:update'
  session_key: string
  position: SessionPosition
}

export type ClientAudioControlMessage = AudioConfigUpdateMessage | SessionConfigUpdateMessage

export interface AudioEngineStatus {
  enabled: boolean
  reason: string | null
  player: string | null
}

export interface InitPayload {
  type: 'init'
  sessions: Session[]
  audio_config?: GlobalAudioConfig
  session_positions?: Record<string, SessionPosition>
  audio_engine?: AudioEngineStatus
}

export interface Session {
  session_id: string
  machine_id: string
  pan: number
  index: number
  color: string
  event_count: number
  last_seen?: string
}

export interface SoundParams {
  note?: string
  notes?: string[]
  duration: number
  type: OscillatorType
  gain: number
}

export interface SoundConfig {
  [key: string]: SoundParams | { [toolName: string]: SoundParams }
}

export interface Position {
  x: number
  y: number
}

export interface PulseRing {
  x: number
  y: number
  radius: number
  growthRate: number
  maxRadius: number
  lineWidth: number
  color: string
  alpha: number
  lifetime: number
  maxLifetime: number
}
