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

export interface Session {
  session_id: string
  machine_id: string
  pan: number
  index: number
  color: string
  event_count: number
  last_seen?: string
}

export interface AudioGlobalConfig {
  volume: number
  reverb: number
  muted: boolean
}

export interface SessionPosition {
  x: number
  y: number
}

export interface AudioConfigSnapshot {
  global: AudioGlobalConfig
  session_positions: Record<string, SessionPosition>
}

export interface AudioConfigPatch {
  global?: Partial<AudioGlobalConfig>
  session_positions?: Record<string, SessionPosition | null>
}

export interface AudioConfigReplaceMessage {
  type: 'audio_config.replace'
  version: 1
  payload: AudioConfigSnapshot
}

export interface AudioConfigPatchMessage {
  type: 'audio_config.patch'
  version: 1
  payload: AudioConfigPatch
}

export type AudioConfigMessage = AudioConfigReplaceMessage | AudioConfigPatchMessage

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
