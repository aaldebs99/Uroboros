import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { StoredSegment } from "../src/library/sponsorSegments.ts";
import { SponsorBlockError, type SponsorBlockClient } from "../src/sponsorblock/client.ts";

/** One request the stub SponsorBlock received. */
export interface StubAsk {
  path: string;
  query: URLSearchParams;
}

/** What the stub answers: a status, a JSON body, and how long it waits first. */
export interface StubAnswer {
  status: number;
  body?: unknown;
  delayMs?: number;
}

/**
 * SponsorBlock's API on 127.0.0.1, so no test reaches the real one: answers each request with the
 * next queued answer (the last repeats; 404 when none is queued) and records it.
 */
export class SponsorBlockStub {
  readonly asked: StubAsk[] = [];
  private answers: StubAnswer[] = [];
  private server: Server | null = null;
  private port = 0;

  static async start(): Promise<SponsorBlockStub> {
    const stub = new SponsorBlockStub();
    stub.server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://stub");
      stub.asked.push({ path: url.pathname, query: url.searchParams });
      const answer = stub.answers.length > 1 ? stub.answers.shift() : stub.answers[0];
      const send = () => {
        res.writeHead(answer?.status ?? 404, { "content-type": "application/json" });
        res.end(answer?.body === undefined ? "" : JSON.stringify(answer.body));
      };
      if (answer?.delayMs === undefined) send();
      else setTimeout(send, answer.delayMs);
    });
    await new Promise<void>((resolve) => stub.server?.listen(0, "127.0.0.1", resolve));
    stub.port = (stub.server.address() as AddressInfo).port;
    return stub;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${String(this.port)}`;
  }

  /** Sets the answers for the next requests, in order. */
  answer(...answers: StubAnswer[]): void {
    this.answers = answers;
  }

  async close(): Promise<void> {
    const server = this.server;
    if (server === null) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
}

/**
 * A SponsorBlock client for job tests: answers each video id from `answers` (an Error fails it),
 * `[]` for any other, and records the ids (and file lengths) it was asked about.
 */
export function fakeSponsorBlock(
  answers: Record<string, StoredSegment[] | Error> = {},
): SponsorBlockClient & { asked: string[]; durations: (number | null)[] } {
  const asked: string[] = [];
  const durations: (number | null)[] = [];
  return {
    asked,
    durations,
    segments(videoId, duration) {
      asked.push(videoId);
      durations.push(duration);
      const answer = answers[videoId];
      if (answer instanceof Error) {
        return Promise.reject(new SponsorBlockError(answer.message, { cause: answer }));
      }
      return Promise.resolve(answer ?? []);
    },
  };
}
