import * as client from "openid-client";
import type { Logger } from "pino";
import type { OidcConfig } from "../config.ts";

/** The configured OIDC provider, discovered in the background. */
export interface OidcProvider {
  readonly settings: OidcConfig;
  /** True once discovery succeeded. */
  ready(): boolean;
  /** The discovered configuration; null until ready. */
  configuration(): client.Configuration | null;
  /** Discovers with 1–60 s backoff until it succeeds or `signal` aborts. */
  start(signal: AbortSignal): void;
}

const MAX_BACKOFF_MS = 60_000;

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * `fetch` lets tests trust their loopback provider's self-signed certificate; production uses the
 * global fetch. ID-token signatures are always checked against the provider's JWKS (openid-client skips that
 * for token-endpoint responses unless non-repudiation checks are on).
 */
export function createOidcProvider(
  settings: OidcConfig,
  opts: { logger: Logger; fetch?: client.CustomFetch },
): OidcProvider {
  let config: client.Configuration | null = null;

  async function discover(): Promise<client.Configuration> {
    const found = await client.discovery(
      new URL(settings.issuer),
      settings.clientId,
      { [client.clockTolerance]: 30 },
      client.ClientSecretBasic(settings.clientSecret),
      {
        execute: [client.enableNonRepudiationChecks],
        timeout: 10,
        ...(opts.fetch === undefined ? {} : { [client.customFetch]: opts.fetch }),
      },
    );
    if (opts.fetch !== undefined) found[client.customFetch] = opts.fetch;
    if (!found.serverMetadata().supportsPKCE("S256")) {
      throw new Error("the provider does not advertise PKCE S256");
    }
    return found;
  }

  return {
    settings,
    ready: () => config !== null,
    configuration: () => config,
    start(signal) {
      void (async () => {
        let backoff = 1000;
        while (!signal.aborted && config === null) {
          try {
            config = await discover();
            opts.logger.info({ issuer: settings.issuer }, "oidc provider discovered");
          } catch (err) {
            opts.logger.warn(
              { err, issuer: settings.issuer, retryInMs: backoff },
              "oidc discovery failed",
            );
            await abortableSleep(backoff, signal);
            backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
          }
        }
      })();
    },
  };
}
