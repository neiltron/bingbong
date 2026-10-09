export type {
  BingbongEvent,
  EnrichedEvent,
  EventMessage,
  HealthResponse,
  InitMessage,
  ServerMessage,
  SessionSnapshot as Session,
} from '@bingbong/protocol'

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
