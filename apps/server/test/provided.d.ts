declare module "vitest" {
  interface ProvidedContext {
    /** Admin (superuser) URL to a maintenance database on the test Postgres. */
    postgresUrl: string;
    valkeyUrl: string;
  }
}

export {};
