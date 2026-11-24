/**
 * `ratchet forge-host`: no file names the forge's domain.
 *
 * The repository lives on a self-hosted forge and is mirrored to GitHub, and the forge's domain
 * stays private, the history included. The gate cannot name that domain itself, so it learns the
 * forge's host when it runs: from `GITHUB_SERVER_URL`, which the forge's Actions runners set to the
 * instance's URL, or else from the `origin` remote. It then searches every listed file for the
 * host's distinctive label (`duckforge` of `code.duckforge.net`), case-insensitively and with dots
 * and dashes allowed as underscores, so other hosts of the same domain and the domain spelled into
 * a variable name (`RENOVATE_DOCKER_CODE_DUCKFORGE_NET_PASSWORD`) are caught too. It reports where,
 * never the domain itself. A GitHub clone has nothing to keep out, so the gate passes there with a
 * note, as it does when neither source names a host.
 */
import { execFileSync } from "node:child_process";

import { newReport, pushSection, section, type Report } from "./report.ts";
import { read, type Repo } from "./repo.ts";

const GATE = "ratchet forge-host";

/** Second-level labels of public suffixes (`co.uk`, `com.au`): never the distinctive one. */
const SUFFIX_LABELS = new Set(["ac", "co", "com", "edu", "go", "gov", "ne", "net", "or", "org"]);

/** Shorter labels would match ordinary words all over the tree. */
const MIN_LABEL_CHARS = 4;

const ADVICE =
  'The repository is mirrored to GitHub and the forge\'s domain stays private, the history included.\nSay "the forge", use the REGISTRY variable or a placeholder such as forge.example, and never paste the forge\'s URLs.\nA line that reached a pushed commit needs the history rewritten as well (CLAUDE.md, "Forge and release").';

/** The host of a git remote URL, `scheme://` or scp-like `user@host:path`; none for a local path. */
export function hostOfRemote(url: string): string | undefined {
  const trimmed = url.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const host = new URL(trimmed).hostname;
      return host === "" ? undefined : host;
    } catch {
      return undefined;
    }
  }
  return /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)/.exec(trimmed)?.[1];
}

/** The forge's host: the Actions server URL when set, else the origin remote's. */
export function forgeHostOf(
  serverUrl: string | undefined,
  originUrl: string | undefined,
): string | undefined {
  const fromServer = serverUrl ? hostOfRemote(serverUrl) : undefined;
  return fromServer ?? (originUrl === undefined ? undefined : hostOfRemote(originUrl));
}

/** The label that names the domain (`duckforge` of `code.duckforge.net`), or none worth searching. */
export function distinctiveLabel(host: string): string | undefined {
  const labels = host.toLowerCase().split(".");
  if (/[[\]:]/.test(host) || labels.every((label) => /^\d+$/.test(label))) {
    return undefined;
  }
  for (let i = labels.length - 2; i >= 0; i--) {
    const label = labels.at(i);
    if (label !== undefined && !SUFFIX_LABELS.has(label)) {
      return label.length >= MIN_LABEL_CHARS ? label : undefined;
    }
  }
  return undefined;
}

/** Matches the label in any case, with `.` and `-` also written `_`. */
function labelPattern(label: string): RegExp {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/-/g, "[-_]");
  return new RegExp(escaped, "i");
}

/** `path:line` for every line of a text file that matches. Files with a NUL byte are not text. */
function mentions(repo: Repo, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const rel of repo.files) {
    const content = read(repo.root, rel);
    if (content.includes("\0")) {
      continue;
    }
    content.split("\n").forEach((line, index) => {
      if (pattern.test(line)) {
        found.push(`${rel}:${String(index + 1)}`);
      }
    });
  }
  return found;
}

/** Searches the tree for the forge's domain, given the forge's host. Pure apart from reading files. */
export function evaluateForgeHost(repo: Repo, host: string | undefined): Report {
  const report = newReport(GATE, "nothing checked");
  if (host === undefined) {
    report.notes.push(
      "the forge's host is unknown (no GITHUB_SERVER_URL, and no origin remote with a host)",
    );
    return report;
  }
  const label = distinctiveLabel(host);
  if (label === undefined) {
    report.notes.push("the forge's host has no distinctive name to search for");
    return report;
  }
  if (label === "github") {
    report.notes.push("this is a GitHub clone or run, with no forge domain to keep out");
    return report;
  }
  report.summary = `no file names the forge's domain (${String(repo.files.length)} files searched)`;
  pushSection(
    report,
    section("line(s) naming the forge's domain", mentions(repo, labelPattern(label)), ADVICE),
  );
  return report;
}

/** The origin remote's URL, if the repository has one. */
function originUrl(root: string): string | undefined {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

export function runForgeHost(repo: Repo): Report {
  return evaluateForgeHost(repo, forgeHostOf(process.env.GITHUB_SERVER_URL, originUrl(repo.root)));
}
