declare module "vitest" {
  interface ProvidedContext {
    /** Admin (superuser) URL to a maintenance database on the test Postgres. */
    postgresUrl: string;
    /** RustFS's S3 endpoint, credentials in s3Credentials.ts. */
    s3Url: string;
  }
}

export {};
