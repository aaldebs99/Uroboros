import type { Logger } from "pino";

/**
 * A leader duty that runs `pass` at once and then every `everyMs` until `signal` aborts; a failed
 * pass is logged and the next one runs on time.
 */
export function periodicDuty(
  name: string,
  everyMs: number,
  pass: () => Promise<unknown>,
  logger: Logger,
): (signal: AbortSignal) => Promise<void> {
  return async (signal) => {
    const run = async () => {
      try {
        await pass();
      } catch (err) {
        logger.warn({ err, duty: name }, "a leader duty failed");
      }
    };
    await run();
    // Leadership may have ended during the first pass: an abort that already fired never reaches
    // a listener added now.
    if (signal.aborted) return;
    await new Promise<void>((resolve) => {
      const every = setInterval(() => void run(), everyMs);
      signal.addEventListener(
        "abort",
        () => {
          clearInterval(every);
          resolve();
        },
        { once: true },
      );
    });
  };
}
