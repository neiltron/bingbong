import type {
  EnrichedEvent,
  BingbongEvent,
  SessionSnapshot,
} from "@bingbong/protocol";
import type { RuntimeStats } from "./logger";

interface SessionRecord extends Omit<SessionSnapshot, "first_seen" | "last_seen"> {
  first_seen: Date;
  last_seen: Date;
  label: string;
  /** True once the label came from a cwd, false while it's an id fallback. */
  label_from_cwd: boolean;
}

interface SessionCreation {
  key: string;
  label: string;
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

    // Upgrade an id-fallback label once a cwd shows up
    if (!session.label_from_cwd) {
      const derived = this.deriveLabel(event.cwd, event.session_id);
      if (derived.fromCwd) {
        session.label = derived.label;
        session.label_from_cwd = true;
      }
    }

    return {
      event: {
        ...event,
        pan: session.pan,
        session_index: session.index,
        color: session.color,
        session_label: session.label,
      },
      createdSession: createdSession
        ? {
            key,
            label: session.label,
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
      label: session.label,
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

    const { label, fromCwd } = this.deriveLabel(event.cwd, event.session_id);

    const session: SessionRecord = {
      session_id: event.session_id,
      machine_id: event.machine_id,
      label,
      label_from_cwd: fromCwd,
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

  /**
   * Human-readable session label: the cwd's directory name, suffixed
   * with a counter when another active session already claimed it
   * (e.g. two agents in the same repo). Falls back to a short id
   * prefix until an event carrying a cwd arrives.
   */
  private deriveLabel(
    cwd: unknown,
    sessionId: string,
  ): { label: string; fromCwd: boolean } {
    const base =
      typeof cwd === "string"
        ? cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? ""
        : "";

    if (!base) {
      return { label: sessionId.slice(0, 8), fromCwd: false };
    }

    const taken = new Set(
      Array.from(this.sessions.values(), (session) => session.label),
    );
    let label = base;
    for (let n = 2; taken.has(label); n++) {
      label = `${base} (${n})`;
    }

    return { label, fromCwd: true };
  }
}
