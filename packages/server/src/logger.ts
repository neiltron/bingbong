export interface RuntimeStats {
  sessionCount: number;
  clientCount: number;
  eventCount: number;
}

export type RuntimeStatsProvider = () => RuntimeStats;

export interface RuntimeLogger {
  info(message: string): void;
  error(message: string, err?: unknown): void;
  dispose(): void;
}

export class PlainLogger implements RuntimeLogger {
  info(message: string) {
    console.log(message);
  }

  error(message: string, err?: unknown) {
    if (err !== undefined) {
      console.error(message, err);
      return;
    }

    console.error(message);
  }

  dispose() {}
}
