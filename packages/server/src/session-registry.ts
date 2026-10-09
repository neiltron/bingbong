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

/** Persistable registry dump; label_from_cwd is internal, so it rides alongside the snapshot. */
export interface RegistryState {
  counter: number;
  sessions: (SessionSnapshot & { label_from_cwd?: boolean })[];
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

/** non-negative and still safe after +1, so a continued counter can never repeat an index */
const isIndex = (n: unknown): n is number =>
  Number.isSafeInteger(n) && (n as number) >= 0 && Number.isSafeInteger((n as number) + 1);

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

  toJSON(): RegistryState {
    const records = Array.from(this.sessions.values());
    return {
      counter: this.sessionCounter,
      sessions: this.snapshots().map((snapshot, i) => ({
        ...snapshot,
        label_from_cwd: records[i].label_from_cwd,
      })),
    };
  }

  /** Tolerant restore: anything malformed is dropped, bad/missing input gives an empty registry. */
  static fromJSON(state: RegistryState | undefined | null): SessionRegistry {
    const registry = new SessionRegistry();
    if (!state || typeof state !== "object" || !Array.isArray(state.sessions)) {
      return registry;
    }

    let counter = isIndex(state.counter) ? state.counter : 0;
    for (const s of state.sessions) {
      if (
        !s ||
        typeof s.session_id !== "string" ||
        typeof s.machine_id !== "string" ||
        !isIndex(s.index) ||
        typeof s.first_seen !== "string" ||
        typeof s.last_seen !== "string"
      ) {
        continue;
      }
      const first_seen = new Date(s.first_seen);
      const last_seen = new Date(s.last_seen);
      if (Number.isNaN(first_seen.getTime()) || Number.isNaN(last_seen.getTime())) {
        continue;
      }

      registry.sessions.set(`${s.machine_id}:${s.session_id}`, {
        session_id: s.session_id,
        machine_id: s.machine_id,
        label: typeof s.label === "string" ? s.label : s.session_id.slice(0, 8),
        label_from_cwd: s.label_from_cwd === true,
        first_seen,
        last_seen,
        event_count: Number.isFinite(s.event_count) ? s.event_count : 0,
        pan: Number.isFinite(s.pan) ? s.pan : 0,
        index: s.index,
        color:
          typeof s.color === "string"
            ? s.color
            : SESSION_COLORS[s.index % SESSION_COLORS.length],
      });
      counter = Math.max(counter, s.index + 1);
    }
    registry.sessionCounter = counter;

    return registry;
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
