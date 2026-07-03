export interface BingbongEvent {
  event_type: string;
  session_id: string;
  machine_id: string;
  timestamp: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: Record<string, unknown>;
}

export interface EnrichedEvent extends BingbongEvent {
  pan: number;
  session_index: number;
  color: string;
  session_label?: string;
}

export interface SessionSnapshot {
  session_id: string;
  machine_id: string;
  label?: string;
  pan: number;
  index: number;
  color: string;
  event_count: number;
  first_seen?: string;
  last_seen?: string;
}

export const PROTOCOL_VERSION = 1;

export interface InitMessage {
  type: "init";
  protocol_version: number;
  sessions: SessionSnapshot[];
}

export interface EventMessage {
  type: "event";
  event: EnrichedEvent;
}

export type ServerMessage = InitMessage | EventMessage;

export interface HealthResponse {
  name: string;
  version: string;
  sessions: number;
  clients: number;
}
