/**
 * Why a fetch's run stops short of an outcome, and the registry that stops them
 * (docs/downloads.md "Cancel and retry"; a large one's stop is `TooLarge`, in sizeHold.ts).
 */

/**
 * Why a fetch was aborted when the process is stopping: not a person's cancel and not a failure,
 * so the job goes back to the queue for another replica and no outcome is recorded.
 */
export class ShutdownAbort extends Error {
  override readonly name = "ShutdownAbort";
  constructor() {
    super("the process is shutting down");
  }
}

/** The run lost its job (its lease lapsed and another run has it): stop, recording nothing. */
export class LeaseLost extends Error {
  override readonly name = "LeaseLost";
}

/** Aborts running fetches: one by key (a cancel), or all of them (shutdown). */
export function createCancelRegistry() {
  const running = new Map<string, AbortController>();
  return {
    start(key: string): AbortController {
      const controller = new AbortController();
      running.set(key, controller);
      return controller;
    },
    end(key: string): void {
      running.delete(key);
    },
    cancel(key: string): void {
      running.get(key)?.abort(new Error("cancelled"));
    },
    /** Aborts every running fetch with a `ShutdownAbort`; they go back to the queue. */
    abortAll(): void {
      for (const controller of running.values()) controller.abort(new ShutdownAbort());
    },
  };
}
export type CancelRegistry = ReturnType<typeof createCancelRegistry>;
