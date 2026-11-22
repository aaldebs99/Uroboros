/**
 * Repository discovery and file listing: the only place the gates learn what exists.
 *
 * The file set comes from `git ls-files --cached --others --exclude-standard`: tracked files plus
 * untracked-but-not-ignored ones. That is exactly "what would be committed", so build output,
 * `node_modules` and anything else `.gitignore` covers is excluded by the same rule git itself
 * uses, with no hand-maintained skip list to drift.
 */
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** What a gate needs to know about the repository. */
export type Repo = { root: string; files: string[] };

/**
 * The gate could not run: a missing file, an unparseable config, a git failure. Always exit
 * code 2, never a pass.
 */
export class LayoutError extends Error {
  override name = "LayoutError";
}

/** The repository root, as git reports it for this module's location. */
export function repoRoot(): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: import.meta.dirname,
      encoding: "utf8",
    }).trim();
  } catch (error) {
    throw new LayoutError(
      `cannot locate the repository root: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Splits `git ls-files -z` output into paths, dropping empty entries. */
export function splitNul(raw: string): string[] {
  return raw.split("\0").filter((entry) => entry !== "");
}

function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Every file git would consider part of the working tree, as repo-relative `/` paths, sorted and
 * de-duplicated. Entries that are not regular files on disk are dropped: a tracked file deleted in
 * the working tree, and symlinks (so one file is never counted under two paths).
 */
export function listedFiles(root: string): string[] {
  let stdout: string;
  try {
    stdout = execFileSync(
      "git",
      ["-c", "core.quotepath=off", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (error) {
    throw new LayoutError(
      `\`git ls-files\` failed in ${root}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return [...new Set(splitNul(stdout))].sort().filter((rel) => isRegularFile(join(root, rel)));
}

export function discover(root: string): Repo {
  return { root, files: listedFiles(root) };
}

/** Reads a repo-relative file as UTF-8, with an error that names the path. */
export function read(root: string, rel: string): string {
  try {
    return readFileSync(join(root, rel), "utf8");
  } catch {
    throw new LayoutError(`cannot read \`${rel}\` (expected at ${join(root, rel)})`);
  }
}

/**
 * Whether a repo-relative path resolves to a regular file. Follows symlinks, unlike the file
 * listing: a symlinked Dockerfile exists, and `read` would read it.
 */
export function exists(root: string, rel: string): boolean {
  try {
    return statSync(join(root, rel)).isFile();
  } catch {
    return false;
  }
}

/**
 * Lower-cased extension of a repo-relative path, if its file name has one. Lower-cased so
 * `Foo.TS` is governed like `foo.ts`.
 */
export function extension(rel: string): string | undefined {
  const name = rel.slice(rel.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    return undefined;
  }
  return name.slice(dot + 1).toLowerCase();
}

const SOURCE_EXTENSIONS = new Set(["ts", "tsx", "js", "mjs"]);

/** Directory segments whose contents are generated, not written by hand. */
const GENERATED_SEGMENT = "generated";

/** Whether `path` is generated output or build output, which no human can act on. */
export function isGenerated(path: string): boolean {
  const segments = path.split("/");
  return segments.includes(GENERATED_SEGMENT) || segments.includes("dist");
}

/** Whether `path` is a hand-written script source file that the ratchets govern. */
export function isGovernedSource(path: string): boolean {
  const ext = extension(path);
  return ext !== undefined && SOURCE_EXTENSIONS.has(ext) && !isGenerated(path);
}
