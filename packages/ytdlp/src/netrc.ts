import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SiteLoginSecret } from "./args.ts";
import { YtDlpError } from "./errors.ts";

/** yt-dlp's own rule for a netrc machine name (`_get_netrc_login_info`). */
const MACHINE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CONTROL = /\p{Cc}/u;

/**
 * A netrc value as a quoted token, which Python's `netrc` (3.11 and later) reads back exactly:
 * spaces, `#` and quotes included.
 */
function quoted(value: string): string {
  if (value === "" || CONTROL.test(value)) {
    throw new YtDlpError("invalid_arguments", "a saved login is empty or has a control character");
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** The `.netrc` text for these logins: one `machine … login … password …` line each. */
export function netrcText(logins: readonly SiteLoginSecret[]): string {
  return logins
    .map((login) => {
      if (!MACHINE.test(login.site)) {
        throw new YtDlpError("invalid_arguments", `not a netrc machine name: ${login.site}`);
      }
      return `machine ${login.site} login ${quoted(login.username)} password ${quoted(login.password)}\n`;
    })
    .join("");
}

/**
 * Runs `fn` with a private directory holding a `.netrc` of these logins (or null when there are
 * none) and removes it afterwards. The file is readable by this user only.
 */
export async function withNetrc<T>(
  logins: readonly SiteLoginSecret[],
  fn: (dir: string | null) => Promise<T>,
): Promise<T> {
  if (logins.length === 0) return fn(null);
  const text = netrcText(logins);
  const dir = await mkdtemp(join(tmpdir(), "uroboros-netrc-"));
  try {
    await writeFile(join(dir, ".netrc"), text, { mode: 0o600 });
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
