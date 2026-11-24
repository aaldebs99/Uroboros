import { describe, expect, it } from "vitest";

import { distinctiveLabel, evaluateForgeHost, forgeHostOf, hostOfRemote } from "./forgeHost.ts";
import { isOk, renderFailure, renderOk } from "./report.ts";
import { tempRepo } from "./testRepo.ts";

describe("hostOfRemote", () => {
  it.each([
    ["https://code.duckforge.net/owner/repo.git", "code.duckforge.net"],
    ["https://user:token@code.duckforge.net:3000/owner/repo", "code.duckforge.net"],
    ["ssh://git@code.duckforge.net:2222/owner/repo.git", "code.duckforge.net"],
    ["git@code.duckforge.net:owner/repo.git", "code.duckforge.net"],
    ["code.duckforge.net:owner/repo.git", "code.duckforge.net"],
  ])("%s → %s", (url, host) => {
    expect(hostOfRemote(url)).toBe(host);
  });

  it.each(["/srv/git/repo.git", "../repo", "file:///srv/git/repo.git", ""])(
    "%s has no host",
    (url) => {
      expect(hostOfRemote(url)).toBeUndefined();
    },
  );
});

describe("forgeHostOf", () => {
  it("prefers the Actions server URL, which the forge's runners set", () => {
    expect(forgeHostOf("https://ci.duckforge.net", "https://code.duckforge.net/o/r.git")).toBe(
      "ci.duckforge.net",
    );
  });

  it("falls back to the origin remote", () => {
    expect(forgeHostOf(undefined, "git@code.duckforge.net:o/r.git")).toBe("code.duckforge.net");
    expect(forgeHostOf("", "git@code.duckforge.net:o/r.git")).toBe("code.duckforge.net");
  });

  it("knows no host without either", () => {
    expect(forgeHostOf(undefined, undefined)).toBeUndefined();
    expect(forgeHostOf(undefined, "/srv/git/repo.git")).toBeUndefined();
  });
});

describe("distinctiveLabel", () => {
  it.each([
    ["code.duckforge.net", "duckforge"],
    ["duckforge.net", "duckforge"],
    ["git.duck-forge.co.uk", "duck-forge"],
    ["github.com", "github"],
    ["CODE.DuckForge.NET", "duckforge"],
  ])("%s → %s", (host, label) => {
    expect(distinctiveLabel(host)).toBe(label);
  });

  it.each(["localhost", "10.0.0.7", "[::1]", "a.io", "co.uk"])("%s has none", (host) => {
    expect(distinctiveLabel(host)).toBeUndefined();
  });
});

describe("evaluateForgeHost", () => {
  const tree = {
    "README.md": "# Repo\n\nHosted somewhere private.\n",
    Dockerfile: "FROM ghcr.io/owner/tool:1@sha256:abc AS tool\n",
  };

  it("passes a tree that never names the forge", () => {
    const report = evaluateForgeHost(tempRepo(tree), "code.duckforge.net");
    expect(isOk(report)).toBe(true);
    expect(renderOk(report)).toContain("2 files");
  });

  it("names every file and line that mentions the forge's domain, in any of its hosts", () => {
    const repo = tempRepo({
      ...tree,
      "docs/forge.md":
        "one\nclone https://code.duckforge.net/o/r\nthree\nci at gitea.DuckForge.net\n",
      "cliff.toml": 'repo = "https://code.duckforge.net/o/r"\n',
    });
    const report = evaluateForgeHost(repo, "code.duckforge.net");
    expect(isOk(report)).toBe(false);
    expect(report.sections[0]?.items).toEqual([
      "cliff.toml:1",
      "docs/forge.md:2",
      "docs/forge.md:4",
    ]);
  });

  it("catches the domain spelled into a variable name, dots and dashes as underscores", () => {
    const repo = tempRepo({
      ...tree,
      ".github/workflows/bot.yml": "env:\n  BOT_DOCKER_GIT_DUCK_FORGE_CO_UK_PASSWORD: x\n",
    });
    const report = evaluateForgeHost(repo, "git.duck-forge.co.uk");
    expect(report.sections[0]?.items).toEqual([".github/workflows/bot.yml:2"]);
  });

  it("never prints the domain it found, only where", () => {
    const repo = tempRepo({ ...tree, "a.md": "see code.duckforge.net\n" });
    expect(renderFailure(evaluateForgeHost(repo, "code.duckforge.net"))).not.toMatch(/duckforge/i);
  });

  it("lists what the history scan finds, given the label", () => {
    const history = (label: string) => (label === "duckforge" ? ["commit abc1234: message"] : []);
    const report = evaluateForgeHost(tempRepo(tree), "code.duckforge.net", history);
    expect(isOk(report)).toBe(false);
    expect(report.sections.map((s) => s.items)).toEqual([["commit abc1234: message"]]);
  });

  it("skips files that are not text", () => {
    const repo = tempRepo({ ...tree, "icon.png": "\u0000PNG code.duckforge.net" });
    expect(isOk(evaluateForgeHost(repo, "code.duckforge.net"))).toBe(true);
  });

  it("has nothing to keep out of a GitHub clone, so says so and passes", () => {
    const repo = tempRepo({ ...tree, "a.md": "https://github.com/owner/repo\n" });
    const report = evaluateForgeHost(repo, "github.com");
    expect(isOk(report)).toBe(true);
    expect(report.notes.join("\n")).toMatch(/github/i);
  });

  it("says it could not learn the forge, and passes, without a host", () => {
    const report = evaluateForgeHost(tempRepo(tree), undefined);
    expect(isOk(report)).toBe(true);
    expect(report.notes.join("\n")).toMatch(/GITHUB_SERVER_URL/);
  });
});
