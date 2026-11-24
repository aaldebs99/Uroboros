import type { DownloadErrorKind } from "@uroboros/contract";
import { Link } from "@tanstack/react-router";

/** Under a login wall or a refused login: the way to Settings › Logins. Nothing for other kinds. */
export function LoginHint({ kind }: { kind: DownloadErrorKind | null }) {
  if (kind !== "login_required" && kind !== "login_failed") return null;
  return (
    <Link
      to="/settings/logins"
      className="w-fit text-sm text-primary no-underline hover:underline focus-visible:underline focus-visible:outline-none"
    >
      Open Settings › Logins
    </Link>
  );
}
