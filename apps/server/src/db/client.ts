import pg from "pg";

/** TCP keepalive starts probing an idle connection after this long, to notice a vanished peer. */
export const KEEPALIVE_DELAY_MS = 10_000;

/**
 * A `pg.Client` of its own, outside every pool, named `application_name` so `pg_stat_activity`
 * says what it is for. No query timeout: its owner bounds what it runs. TCP keepalive is on, so a
 * peer that vanished is noticed even while the connection sits idle. The caller attaches its own
 * 'error' listener before connecting.
 */
export function dedicatedClient(url: string, applicationName: string): pg.Client {
  return new pg.Client({
    connectionString: url,
    application_name: applicationName,
    keepAlive: true,
    keepAliveInitialDelayMillis: KEEPALIVE_DELAY_MS,
  });
}

/**
 * Closes the socket at once, without the goodbye `end()` waits on (a silent server never answers
 * it). The server drops the session, and with it every session lock, once it notices.
 */
export function destroyClient(client: pg.Client): void {
  client.connection.stream.destroy();
}
