/**
 * The history half of `ratchet forge-host`: every commit reachable from HEAD and every tag, the
 * other way the forge's domain reaches the GitHub mirror. A file check sees only the tip, but the
 * mirror carries the whole history, and the forge stamps its domain into commits it makes itself
 * (`Reviewed-on:` trailers, noreply addresses of web merges and bots). Each finding names the
 * commit or tag and the field, never the domain.
 */
import { execFileSync } from "node:child_process";

import { LayoutError } from "./repo.ts";

/** Field and record separators of the formats below (a commit message holds neither). */
const FIELD = "\0";
const RECORD = "\x1e";

/**
 * The label as an extended regular expression that git and JavaScript read alike: each letter in
 * either case, and `-`, `.` and `_` interchangeable (`duck-forge` also matches `DUCK_FORGE`).
 */
export function labelEre(label: string): string {
  let ere = "";
  for (const char of label) {
    if (/[a-z]/i.test(char)) {
      ere += `[${char.toLowerCase()}${char.toUpperCase()}]`;
    } else if (/[-._]/.test(char)) {
      ere += "[-._]";
    } else {
      ere += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return ere;
}

function records(raw: string): string[][] {
  return raw
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ""))
    .filter((record) => record !== "")
    .map((record) => record.split(FIELD));
}

/** Which of a commit's author, committer and message name the forge (`%h %an %ae %cn %ce %B`). */
export function metadataMentions(raw: string, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const [
    sha = "",
    authorName = "",
    authorEmail = "",
    name = "",
    email = "",
    ...message
  ] of records(raw)) {
    const fields: [string, string][] = [
      ["author", `${authorName} ${authorEmail}`],
      ["committer", `${name} ${email}`],
      ["message", message.join(FIELD)],
    ];
    for (const [field, text] of fields) {
      if (pattern.test(text)) {
        found.push(`commit ${sha}: ${field}`);
      }
    }
  }
  return found;
}

/** Tags whose tagger or message name the forge (`%(refname:short) %(taggername) %(taggeremail) %(contents)`). */
export function tagMentions(raw: string, pattern: RegExp): string[] {
  return records(raw)
    .filter(([, ...fields]) => fields.some((field) => pattern.test(field)))
    .map(([name = ""]) => `tag ${name}`);
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function hasHead(root: string): boolean {
  try {
    git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

/** Every commit reachable from HEAD, and every tag, that names the label. Needs the full history. */
export function historyMentions(root: string, label: string): string[] {
  if (git(root, ["rev-parse", "--is-shallow-repository"]).trim() === "true") {
    throw new LayoutError(
      "the checkout is a shallow clone, so the history cannot be checked (actions/checkout needs fetch-depth: 0)",
    );
  }
  if (!hasHead(root)) {
    return [];
  }
  const ere = labelEre(label);
  const pattern = new RegExp(ere);
  const diffs = git(root, ["log", "-E", "--text", `-G${ere}`, "--format=%h", "HEAD"])
    .split("\n")
    .filter((sha) => sha !== "")
    .map((sha) => `commit ${sha}: diff`);
  const metadata = git(root, ["log", `--format=%h%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x1e`, "HEAD"]);
  const tags = git(root, [
    "for-each-ref",
    "refs/tags",
    "--format=%(refname:short)%00%(taggername)%00%(taggeremail)%00%(contents)%1e",
  ]);
  return [...diffs, ...metadataMentions(metadata, pattern), ...tagMentions(tags, pattern)];
}
