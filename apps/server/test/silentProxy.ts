import { connect, createServer } from "node:net";
import type { AddressInfo, Socket } from "node:net";

export interface SilentProxy {
  /** The upstream URL with its host and port pointed at the proxy. */
  url: string;
  /**
   * Mutes every connection open now, for good: the proxy keeps both sockets open and drops what
   * either side sends, as a peer that vanished without a FIN looks. New connections are muted too
   * until `resume()`.
   */
  silence(): void;
  /** New connections forward again; the ones `silence()` muted stay muted. */
  resume(): void;
  close(): Promise<void>;
}

/** A TCP proxy in front of `upstream` (a postgres:// or redis:// URL) that can go silent. */
export async function silentProxy(upstream: string): Promise<SilentProxy> {
  const target = new URL(upstream);
  const sockets = new Set<Socket>();
  const pairs = new Set<{ muted: boolean }>();
  let silent = false;
  const server = createServer((client) => {
    const pair = { muted: silent };
    pairs.add(pair);
    const server = connect(Number(target.port), target.hostname);
    for (const s of [client, server]) {
      sockets.add(s);
      s.on("error", () => undefined);
      s.on("close", () => sockets.delete(s));
    }
    client.on("data", (chunk: Buffer) => {
      if (!pair.muted) server.write(chunk);
    });
    server.on("data", (chunk: Buffer) => {
      if (!pair.muted) client.write(chunk);
    });
    client.on("close", () => server.destroy());
    server.on("close", () => client.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const url = new URL(upstream);
  url.hostname = "127.0.0.1";
  url.port = String(port);
  return {
    url: url.toString(),
    silence() {
      silent = true;
      for (const pair of pairs) pair.muted = true;
    },
    resume() {
      silent = false;
    },
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    },
  };
}
