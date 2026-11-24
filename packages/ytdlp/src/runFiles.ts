import type { RunFiles, YtDlpOptions } from "./args.ts";
import { withCookiesCopy } from "./cookies.ts";
import { withNetrc } from "./netrc.ts";

/** Runs `fn` with the run's private cookies copy and `.netrc`, both removed afterwards. */
export function withRunFiles<T>(
  options: Pick<YtDlpOptions, "cookiesFile" | "logins">,
  fn: (files: RunFiles) => Promise<T>,
): Promise<T> {
  return withCookiesCopy(options.cookiesFile, (cookies) =>
    withNetrc(options.logins ?? [], (netrcDir) => fn({ cookies, netrcDir })),
  );
}

/** The saved passwords, which the kept stderr lines must never show. */
export function secretsOf(options: Pick<YtDlpOptions, "logins">): string[] {
  return (options.logins ?? []).map((login) => login.password);
}
