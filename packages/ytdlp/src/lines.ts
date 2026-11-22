/**
 * Splits a decoded text stream into lines, holding back a trailing partial line until the rest of
 * it arrives. yt-dlp ends progress lines with `\n` under `--newline` and with `\r` without it, so
 * either ends a line; empty lines are dropped.
 */
export class LineSplitter {
  private pending = "";

  /** Feeds a chunk and returns every line it completed. */
  push(chunk: string): string[] {
    const parts = (this.pending + chunk).split(/\r\n|\r|\n/);
    this.pending = parts.pop() ?? "";
    return parts.filter((line) => line.length > 0);
  }

  /** Returns the held-back partial line, if any, once the stream has ended. */
  flush(): string[] {
    const rest = this.pending;
    this.pending = "";
    return rest.length > 0 ? [rest] : [];
  }
}

/** Keeps the last `limit` lines pushed into it. */
export class LineTail {
  private readonly lines: string[] = [];
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  push(line: string): void {
    this.lines.push(line);
    if (this.lines.length > this.limit) this.lines.shift();
  }

  get(): string[] {
    return [...this.lines];
  }
}
