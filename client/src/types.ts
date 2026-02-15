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

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
  alpha: number
  lifetime: number
  maxLifetime: number
}
