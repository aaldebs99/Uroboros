import { connect, createServer } from "node:net";
import type { AddressInfo, Server, Socket } from "node:net";

/** A port nothing listens on yet: bound, read, and released again. */
export async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => {
    probe.close(() => {
      resolve();
    });
  });
  return port;
}

/** Forwards `port` on 127.0.0.1 to `upstream`'s host and port, from now on. */
export async function forward(port: number, upstream: string): Promise<{ close(): Promise<void> }> {
  const target = new URL(upstream);
  const sockets = new Set<Socket>();
  const server: Server = createServer((client) => {
    const peer = connect(Number(target.port), target.hostname);
    for (const s of [client, peer]) {
      sockets.add(s);
      s.on("error", () => undefined);
      s.on("close", () => sockets.delete(s));
    }
    client.pipe(peer).pipe(client);
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
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
