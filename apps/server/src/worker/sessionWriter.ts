import { forgetSession, isStored, markStored, runToken } from "../transcode/bus.ts";
import { initKey, segmentKey, sessionPrefix } from "../transcode/sessions.ts";
import type { WorkerDeps } from "./deps.ts";

/** Another runner owns the session now (its token is newer): this one stops writing. */
export class FencedError extends Error {}

/** A run's init differs from the one the player already has: the session can't go on. */
export class InitChangedError extends Error {}

/**
 * Stores a session's init and segments for one runner (docs/transcoding.md): each write first
 * checks the runner still holds the session's token, so a runner that lost it (a replica that
 * stalled while another took over) never overwrites the new one's files.
 */
export class SessionWriter {
  readonly #deps: WorkerDeps;
  readonly #sid: string;
  readonly #token: string;

  constructor(deps: WorkerDeps, sid: string, token: string) {
    this.#deps = deps;
    this.#sid = sid;
    this.#token = token;
  }

  get #keys() {
    return { db: this.#deps.db };
  }

  async #fence(): Promise<void> {
    if ((await runToken(this.#keys, this.#sid)) !== this.#token) {
      throw new FencedError("another runner has the session");
    }
  }

  isStored(n: number): Promise<boolean> {
    return isStored(this.#keys, this.#sid, n);
  }

  /** Stores the init once; true the first time. A later run's must be the same bytes. */
  async init(bytes: Buffer): Promise<boolean> {
    if (await this.isStored(-1)) {
      const opened = await this.#deps.store.open(initKey(this.#sid));
      const stored = Buffer.from(await new Response(opened.body).arrayBuffer());
      if (!stored.equals(bytes)) throw new InitChangedError("the transcoder's output changed");
      return false;
    }
    await this.#put(-1, initKey(this.#sid), bytes);
    return true;
  }

  /** Stores a segment unless it already is; true when it was new. */
  async segment(n: number, bytes: Buffer): Promise<boolean> {
    if (await this.isStored(n)) return false;
    await this.#put(n, segmentKey(this.#sid, n), bytes);
    return true;
  }

  async #put(n: number, key: string, bytes: Buffer): Promise<void> {
    await this.#fence();
    await this.#deps.store.putBytes(key, bytes, "video/mp4");
    await markStored(this.#keys, this.#sid, n);
    await this.#deps.playbackBus.publish({ t: "ready", sid: this.#sid, n });
  }
}

/** Removes an ended session's files and keys; a failed delete leaves the prefix to the reaper. */
export async function cleanupSession(deps: WorkerDeps, sid: string): Promise<void> {
  try {
    await deps.store.deletePrefix(sessionPrefix(sid));
  } catch (err) {
    deps.logger.warn({ err, sid }, "could not delete a playback session's files; trashed");
    await deps.db
      .insertInto("storage_trash")
      .values({ key: sessionPrefix(sid) })
      .onConflict((oc) => oc.column("key").doNothing())
      .execute();
  }
  await forgetSession({ db: deps.db }, sid);
}
