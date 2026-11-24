import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { historyMentions, labelEre, metadataMentions, tagMentions } from "./forgeHistory.ts";

const LABEL = "duck-forge";
const pattern = /duck[-_]forge/i;

describe("labelEre", () => {
  it("matches the label in any case, with dashes and dots also written as underscores", () => {
    const re = new RegExp(labelEre(LABEL));
    expect(re.test("https://code.DUCK-forge.net")).toBe(true);
    expect(re.test("RENOVATE_DOCKER_CODE_DUCK_FORGE_NET")).toBe(true);
    expect(re.test("duckforge")).toBe(false);
  });
});

describe("metadataMentions", () => {
  const record = (fields: string[]) => `${fields.join("\0")}\x1e`;

  it("names the commit and the field, never the domain", () => {
    const raw =
      record(["abc1234", "Owner", "owner@example.com", "Owner", "owner@example.com", "feat: x\n"]) +
      record([
        "def5678",
        "Bot",
        "2+bot@noreply.duck-forge.net",
        "Gitea",
        "noreply@duck-forge.net",
        "fix: y\n\nReviewed-on: https://code.duck-forge.net/o/r/pulls/3\n",
      ]);
    expect(metadataMentions(raw, pattern)).toEqual([
      "commit def5678: author",
      "commit def5678: committer",
      "commit def5678: message",
    ]);
  });

  it("passes clean history", () => {
    expect(metadataMentions(record(["abc1234", "A", "a@b.c", "A", "a@b.c", "x"]), pattern)).toEqual(
      [],
    );
  });
});

describe("tagMentions", () => {
  it("names a tag whose tagger or message names the forge", () => {
    const raw = "0.1.0\0\0\0\x1e0.2.0\0Bot\0<bot@duck-forge.net>\0release 0.2.0\n\x1e";
    expect(tagMentions(raw, pattern)).toEqual(["tag 0.2.0"]);
  });
});

describe("historyMentions", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function repo(): { root: string; commit: (file: string, text: string, email?: string) => void } {
    const root = mkdtempSync(join(tmpdir(), "forge-history-"));
    roots.push(root);
    const git = (args: string[], email = "owner@example.com") =>
      execFileSync("git", args, {
        cwd: root,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Owner",
          GIT_AUTHOR_EMAIL: email,
          GIT_COMMITTER_NAME: "Owner",
          GIT_COMMITTER_EMAIL: email,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
    git(["init", "-q", "-b", "main"]);
    return {
      root,
      commit: (file, text, email) => {
        writeFileSync(join(root, file), text);
        git(["add", file], email);
        git(["commit", "-q", "-m", `change ${file}`], email);
      },
    };
  }

  it("finds a mention a later commit removed, and an identity on the domain", () => {
    const r = repo();
    r.commit("README.md", "hello\n");
    r.commit("README.md", "clone https://code.duck-forge.net/o/r\n");
    r.commit("README.md", "clone from the mirror\n");
    r.commit("notes.md", "clean\n", "bot@noreply.duck_forge.net");
    const found = historyMentions(r.root, LABEL);
    expect(found.filter((f) => f.endsWith(": diff"))).toHaveLength(2);
    expect(found.filter((f) => f.endsWith(": author"))).toHaveLength(1);
    expect(found.join("\n")).not.toMatch(/duck/i);
  });

  it("passes a clean history", () => {
    const r = repo();
    r.commit("README.md", "hello\n");
    expect(historyMentions(r.root, LABEL)).toEqual([]);
  });

  it("refuses a shallow clone, whose history it cannot see", () => {
    const r = repo();
    r.commit("a.md", "1\n");
    r.commit("a.md", "2\n");
    const shallow = mkdtempSync(join(tmpdir(), "forge-history-shallow-"));
    roots.push(shallow);
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${r.root}`, shallow], {
      stdio: "ignore",
    });
    expect(() => historyMentions(shallow, LABEL)).toThrow(/shallow/);
  });
});
