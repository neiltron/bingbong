import type {
  RuntimeLogger,
  RuntimeStats,
  RuntimeStatsProvider,
} from "@bingbong/server";

const MAX_EVENT_LOG_LINES = 1000;

interface TerminalLayoutLoggerOptions {
  port: number;
  version: string;
  getStats: RuntimeStatsProvider;
  maxLines?: number;
}

export class TerminalLayoutLogger implements RuntimeLogger {
  private readonly isInteractive: boolean;
  private readonly maxLines: number;
  private readonly port: number;
  private readonly version: string;
  private readonly getStats: RuntimeStatsProvider;
  private readonly resizeHandler: (() => void) | null;
  private logLines: string[] = [];
  private plainMode: boolean;

  constructor({
    port,
    version,
    getStats,
    maxLines = MAX_EVENT_LOG_LINES,
  }: TerminalLayoutLoggerOptions) {
    this.port = port;
    this.version = version;
    this.getStats = getStats;
    this.maxLines = maxLines;
    this.isInteractive = Boolean(process.stdout.isTTY);
    this.plainMode = !this.isInteractive;

    if (this.plainMode) {
      this.writePlainHeader();
      this.resizeHandler = null;
      return;
    }

    this.resizeHandler = () => {
      this.render();
    };

    process.stdout.on("resize", this.resizeHandler);
    this.render();
  }

  info(message: string) {
    this.writeMessage(message, "stdout");
  }

  error(message: string, err?: unknown) {
    const fullMessage =
      err === undefined ? message : `${message} ${this.formatUnknownError(err)}`;

    this.writeMessage(fullMessage, "stderr");
  }

  dispose() {
    if (this.resizeHandler) {
      process.stdout.removeListener("resize", this.resizeHandler);
    }

    if (this.isInteractive && !this.plainMode) {
      process.stdout.write("\x1b[?25h");
    }
  }

  private writeMessage(message: string, target: "stdout" | "stderr") {
    const lines = this.normalizeMessageLines(message);

    if (this.plainMode) {
      this.writePlainLines(lines, target);
      return;
    }

    this.logLines.push(...lines);
    if (this.logLines.length > this.maxLines) {
      this.logLines = this.logLines.slice(-this.maxLines);
    }

    this.render();
  }

  private render() {
    if (this.plainMode) return;

    const rows = process.stdout.rows ?? 24;
    const cols = process.stdout.columns ?? 80;
    const headerLines = createHeaderLines(
      this.port,
      cols,
      this.version,
      this.getStats(),
    );
    const headerCount = headerLines.length;

    if (rows <= headerCount + 1) {
      this.switchToPlainMode();
      return;
    }

    const viewportRows = rows - headerCount - 1;
    const visibleLogs = this.logLines.slice(-viewportRows);
    const paddingRows = Math.max(0, viewportRows - visibleLogs.length);
    const innerW = cols - 2;

    const lines: string[] = [];
    lines.push(...headerLines);

    for (const line of visibleLogs) {
      const fitted = this.fitToWidth(line, innerW);
      const linePad = Math.max(0, innerW - fitted.length);
      lines.push(
        `${BG}${FG_DIM}${BOX.v}${RESET} ${FG_BRIGHT}${fitted}${" ".repeat(Math.max(0, linePad - 1))}${BG}${FG_DIM}${BOX.v}${RESET}`,
      );
    }

    for (let i = 0; i < paddingRows; i++) {
      lines.push(
        `${BG}${FG_DIM}${BOX.v}${" ".repeat(innerW)}${BOX.v}${RESET}`,
      );
    }

    lines.push(
      `${BG}${FG_DIM}${BOX.bl}${BOX.h.repeat(innerW)}${BOX.br}${RESET}`,
    );

    let output = "\x1b[?25l\x1b[2J\x1b[H";
    output += lines.join("\n");

    process.stdout.write(output);
  }

  private switchToPlainMode() {
    this.plainMode = true;

    if (this.resizeHandler) {
      process.stdout.removeListener("resize", this.resizeHandler);
    }

    process.stdout.write("\x1b[?25h\x1b[2J\x1b[H");
    this.writePlainHeader();
    this.writePlainLines(this.logLines, "stdout");
  }

  private writePlainHeader() {
    const cols = process.stdout.columns ?? 80;
    this.writePlainLines(
      createHeaderLines(this.port, cols, this.version, this.getStats()),
      "stdout",
    );
  }

  private writePlainLines(lines: string[], target: "stdout" | "stderr") {
    const stream = target === "stderr" ? process.stderr : process.stdout;
    for (const line of lines) {
      stream.write(`${line}\n`);
    }
  }

  private fitToWidth(line: string, width: number): string {
    if (width <= 0) return "";
    if (line.length <= width) return line;
    if (width === 1) return "…";
    return `${line.slice(0, width - 1)}…`;
  }

  private normalizeMessageLines(message: string): string[] {
    const rawLines = message.split(/\r?\n/);
    return rawLines.map((line) => this.sanitizeLine(line));
  }

  private sanitizeLine(line: string): string {
    return line
      .replace(/\x1B\[[0-9;?]*[A-Za-z]/g, "")
      .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "");
  }

  private formatUnknownError(err: unknown): string {
    if (err instanceof Error) {
      return `${err.name}: ${err.message}`;
    }

    if (typeof err === "string") {
      return err;
    }

    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
}

const BG = "\x1b[48;2;13;27;42m";
const FG = "\x1b[38;2;42;80;112m";
const FG_BRIGHT = "\x1b[38;2;120;160;190m";
const FG_DIM = "\x1b[38;2;30;55;78m";
const FG_LABEL = "\x1b[38;2;80;120;150m";
const FG_ACCENT = "\x1b[38;2;78;205;196m";
const FG_GREEN = "\x1b[38;2;107;155;107m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const BOX = {
  tl: "┌",
  tr: "┐",
  bl: "└",
  br: "┘",
  h: "─",
  v: "│",
  lj: "├",
  rj: "┤",
};

function createHeaderLines(
  port: number,
  width: number,
  version: string,
  stats: RuntimeStats,
): string[] {
  if (width < 20) return [`${BG}${FG}${BOLD} bingbong ${RESET}`];

  const url = `http://localhost:${port}`;
  const innerW = width - 2;

  const lines: string[] = [];

  lines.push(`${BG}${FG_DIM}${BOX.tl}${BOX.h.repeat(innerW)}${BOX.tr}${RESET}`);

  const titleLeft = `bingbong v${version}`;
  const titleRight = url;
  const titleGap = Math.max(1, innerW - titleLeft.length - titleRight.length - 2);
  const titleContent =
    ` ${BG}${FG}${BOLD}bingbong${RESET}${BG}${FG} v${version}` +
    `${" ".repeat(titleGap)}${FG_BRIGHT}${titleRight} `;
  lines.push(`${BG}${FG_DIM}${BOX.v}${titleContent}${FG_DIM}${BOX.v}${RESET}`);

  lines.push(`${BG}${FG_DIM}${BOX.lj}${BOX.h.repeat(innerW)}${BOX.rj}${RESET}`);

  const now = new Date();
  const timeStr = now.toISOString().slice(11, 19) + " UTC";
  const connStatus = stats.clientCount > 0 ? "ESTABLISHED" : "LISTENING";
  const connColor = stats.clientCount > 0 ? FG_GREEN : FG_DIM;
  const hostVal = `localhost`;

  const statusParts =
    ` ${FG_LABEL}HOST:${RESET}${BG} ${FG_BRIGHT}${hostVal}${RESET}${BG}` +
    `  ${connColor}${BOLD}${connStatus}${RESET}${BG}` +
    `   ${FG_LABEL}TIME:${RESET}${BG} ${FG_BRIGHT}${timeStr}${RESET}${BG}`;

  const visibleStatusLen =
    1 + 5 + 1 + hostVal.length + 2 + connStatus.length + 3 + 5 + 1 + timeStr.length;
  const statusPad = Math.max(1, innerW - visibleStatusLen - 1);
  const statusLine = `${statusParts}${" ".repeat(statusPad)} `;

  lines.push(`${BG}${FG_DIM}${BOX.v}${statusLine}${FG_DIM}${BOX.v}${RESET}`);
  lines.push(`${BG}${FG_DIM}${BOX.lj}${BOX.h.repeat(innerW)}${BOX.rj}${RESET}`);

  const sessionsStr = stats.sessionCount === 0 ? "none" : `${stats.sessionCount}`;
  const eventsStr = `${stats.eventCount}`;
  const clientsStr = `${stats.clientCount}`;

  const infoContent =
    ` ${FG_LABEL}SESSIONS:${RESET}${BG} ${FG_ACCENT}${sessionsStr}${RESET}${BG}` +
    `   ${FG_LABEL}CLIENTS:${RESET}${BG} ${FG_BRIGHT}${clientsStr}${RESET}${BG}` +
    `   ${FG_LABEL}EVENTS:${RESET}${BG} ${FG_BRIGHT}${eventsStr}${RESET}${BG}`;

  const visibleInfoLen =
    1 + 9 + 1 + sessionsStr.length + 3 + 8 + 1 + clientsStr.length + 3 + 7 + 1 + eventsStr.length;
  const infoPad = Math.max(1, innerW - visibleInfoLen - 1);
  const infoLine = `${infoContent}${" ".repeat(infoPad)} `;

  lines.push(`${BG}${FG_DIM}${BOX.v}${infoLine}${FG_DIM}${BOX.v}${RESET}`);
  lines.push(`${BG}${FG_DIM}${BOX.bl}${BOX.h.repeat(innerW)}${BOX.br}${RESET}`);

  return lines;
}
