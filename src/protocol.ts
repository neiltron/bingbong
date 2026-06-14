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
}

export interface SessionSnapshot {
  session_id: string;
  machine_id: string;
  pan: number;
  index: number;
  color: string;
  event_count: number;
  first_seen?: string;
  last_seen?: string;
}

export interface InitMessage {
  type: "init";
  sessions: SessionSnapshot[];
}

export type ServerMessage = InitMessage | EnrichedEvent;

export interface HealthResponse {
  name: string;
  version: string;
  sessions: number;
  clients: number;
}
