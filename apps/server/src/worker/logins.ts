import { loginsOf } from "../siteLogins/forJobs.ts";
import type { WorkerDeps } from "./deps.ts";

/**
 * The deps for a run on one person's behalf (their pasted link, their subscription's checks):
 * yt-dlp gets that person's saved site logins (`ytdlpOptions` passes them on), and no one else's.
 */
export async function withLoginsOf(deps: WorkerDeps, userId: string): Promise<WorkerDeps> {
  const logins = await loginsOf(deps.db, deps.ytdlp.secretsKey, userId, deps.logger);
  return logins.length === 0 ? deps : { ...deps, ytdlp: { ...deps.ytdlp, logins } };
}
