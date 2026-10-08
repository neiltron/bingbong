export interface BingbongEvent {
  event_type: string;
  session_id: string;
  machine_id: string;
  /** Session that spawned this one (same machine), for harnesses with agent trees */
  parent_session_id?: string;
  timestamp: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: Record<string, unknown>;
  /** Harness-native event name when event_type was normalized to a canonical type */
  original_event_type?: string;
}

/** Radar position, normalized 0..1 on both axes */
export interface Position {
  x: number;
  y: number;
}

export interface EnrichedEvent extends BingbongEvent {
  pan: number;
  position: Position;
  session_index: number;
  color: string;
  session_label?: string;
}

export interface SessionSnapshot {
  session_id: string;
  machine_id: string;
  parent_session_id?: string;
  label?: string;
  pan: number;
  position: Position;
  index: number;
  color: string;
  event_count: number;
  first_seen?: string;
  last_seen?: string;
}

export const PROTOCOL_VERSION = 2;

export interface InitMessage {
  type: "init";
  protocol_version: number;
  sessions: SessionSnapshot[];
}

export interface EventMessage {
  type: "event";
  event: EnrichedEvent;
}

export interface SessionUpdateMessage {
  type: "session_update";
  session: SessionSnapshot;
}

export type ServerMessage = InitMessage | EventMessage | SessionUpdateMessage;

/** Client -> server: a user dragged a radar source */
export interface MoveSourceMessage {
  type: "move_source";
  machine_id: string;
  session_id: string;
  x: number;
  y: number;
}

export type ClientMessage = MoveSourceMessage;

export interface HealthResponse {
  name: string;
  version: string;
  sessions: number;
  clients: number;
}
