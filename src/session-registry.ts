import type { EnrichedEvent, BingbongEvent, SessionSnapshot } from "./protocol";
import type { RuntimeStats } from "./runtime-logger";

interface SessionRecord extends Omit<SessionSnapshot, "first_seen" | "last_seen"> {
  first_seen: Date;
  last_seen: Date;
}

interface SessionCreation {
  key: string;
  index: number;
  pan: number;
}

export interface EnrichmentResult {
  event: EnrichedEvent;
  createdSession: SessionCreation | null;
}

const SESSION_COLORS = [
  "#FF6B6B",
  "#4ECDC4",
  "#45B7D1",
  "#96CEB4",
  "#FFEAA7",
  "#DDA0DD",
  "#98D8C8",
  "#F7DC6F",
  "#BB8FCE",
  "#85C1E9",
];

export class SessionRegistry {
  private readonly sessions = new Map<string, SessionRecord>();
  private sessionCounter = 0;

  enrich(event: BingbongEvent): EnrichmentResult {
    const { key, session, createdSession } = this.getOrCreateSession(event);

    session.last_seen = new Date();
    session.event_count++;

    return {
      event: {
        ...event,
        pan: session.pan,
        session_index: session.index,
        color: session.color,
      },
      createdSession: createdSession
        ? {
            key,
            index: session.index,
            pan: session.pan,
          }
        : null,
    };
  }

  snapshots(): SessionSnapshot[] {
    return Array.from(this.sessions.values()).map((session) => ({
      session_id: session.session_id,
      machine_id: session.machine_id,
      pan: session.pan,
      index: session.index,
      color: session.color,
      event_count: session.event_count,
      first_seen: session.first_seen.toISOString(),
      last_seen: session.last_seen.toISOString(),
    }));
  }

  stats(clientCount: number): RuntimeStats {
    return {
      sessionCount: this.sessions.size,
      clientCount,
      eventCount: Array.from(this.sessions.values()).reduce(
        (sum, session) => sum + session.event_count,
        0,
      ),
    };
  }

  removeStale(now = Date.now(), staleMs = 30 * 60 * 1000): string[] {
    const removedKeys: string[] = [];

    for (const [key, session] of this.sessions) {
      if (now - session.last_seen.getTime() > staleMs) {
        this.sessions.delete(key);
        removedKeys.push(key);
      }
    }

    return removedKeys;
  }

  private getOrCreateSession(event: BingbongEvent): {
    key: string;
    session: SessionRecord;
    createdSession: boolean;
  } {
    const key = `${event.machine_id}:${event.session_id}`;
    const existing = this.sessions.get(key);
    if (existing) {
      return { key, session: existing, createdSession: false };
    }

    const index = this.sessionCounter++;
    const pan =
      index === 0 ? 0 : ((index % 2 === 1 ? -1 : 1) * Math.ceil(index / 2)) / 5;

    const session: SessionRecord = {
      session_id: event.session_id,
      machine_id: event.machine_id,
      first_seen: new Date(),
      last_seen: new Date(),
      event_count: 0,
      pan: Math.max(-1, Math.min(1, pan)),
      index,
      color: SESSION_COLORS[index % SESSION_COLORS.length],
    };

    this.sessions.set(key, session);

    return { key, session, createdSession: true };
  }
}
