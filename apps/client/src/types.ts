export type {
  BingbongEvent,
  EnrichedEvent,
  HealthResponse,
  InitMessage,
  ServerMessage,
  SessionSnapshot as Session,
} from '@bingbong/protocol'

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
