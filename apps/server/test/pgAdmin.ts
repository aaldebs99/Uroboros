import pg from "pg";

/** Runs `fn` on a short-lived admin connection. */
export async function withAdmin<T>(adminUrl: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
