import { connect, createServer } from "node:net";
import type { AddressInfo, Server, Socket } from "node:net";

/** A port of its own in front of a server, closed until `open()`; see `gate`. */
export interface Gate {
  readonly port: number;
  /** How many connections it has turned away so far. */
  readonly refused: number;
  /** From now on, forward connections to the upstream. */
  open(): void;
  close(): Promise<void>;
}

/**
 * A TCP gate on 127.0.0.1 in front of `upstream`'s host and port. It turns every connection away
 * with a reset (the client sees ECONNRESET) until opened, then forwards. It listens on a port of
 * its own from the start, so nothing else can take that port in between, as another worker's
 * `listen(0)` could take a port that was bound, read and released.
 */
export async function gate(upstream: string): Promise<Gate> {
  const target = new URL(upstream);
  const sockets = new Set<Socket>();
  let opened = false;
  let refused = 0;
  const server: Server = createServer((client) => {
    client.on("error", () => undefined);
    if (!opened) {
      refused += 1;
      client.resetAndDestroy();
      return;
    }
    const peer = connect(Number(target.port), target.hostname);
    for (const s of [client, peer]) {
      sockets.add(s);
      s.on("error", () => undefined);
      s.on("close", () => sockets.delete(s));
    }
    client.pipe(peer).pipe(client);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    get refused() {
      return refused;
    },
    open() {
      opened = true;
    },
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

/** `url` with its host and port pointed at 127.0.0.1:`port`. */
export function onPort(url: string, port: number): string {
  const u = new URL(url);
  u.hostname = "127.0.0.1";
  u.port = String(port);
  return u.toString();
}
