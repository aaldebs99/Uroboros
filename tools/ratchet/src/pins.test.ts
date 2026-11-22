import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { LayoutError } from "./repo.ts";
import { runPins } from "./pins.ts";
import { isOk, renderFailure, renderOk } from "./report.ts";
import { tempRepo } from "./testRepo.ts";

type Overrides = {
  miseNode?: string;
  misePnpm?: string;
  packageManager?: string;
  devEnginesVersion?: string;
  onFail?: string;
  enginesNode?: string;
  dockerNode?: string;
  dockerPnpm?: string;
  pnpmAge?: string;
  renovateAge?: string;
  dockerfile?: boolean;
};

function files(o: Overrides = {}): Record<string, string> {
  const out: Record<string, string> = {
    ".mise/config.toml": `[tools]\nnode = "${o.miseNode ?? "24.21.0"}"\npnpm = "${o.misePnpm ?? "12.12.1"}"\n`,
    "package.json": JSON.stringify({
      packageManager: o.packageManager ?? "pnpm@12.12.1",
      devEngines: {
        packageManager: {
          name: "pnpm",
          version: o.devEnginesVersion ?? "12.12.1",
          onFail: o.onFail ?? "error",
        },
      },
      engines: { node: o.enginesNode ?? ">=24.21.0" },
    }),
    "pnpm-workspace.yaml": `minimumReleaseAge: ${o.pnpmAge ?? "4320"} # minutes\npackages:\n  - tools/*\n`,
    ".renovaterc.json5": `{\n  // soak\n  minimumReleaseAge: "${o.renovateAge ?? "3 days"}",\n  packageRules: [{ matchManagers: ["npm"], minimumReleaseAge: '${o.renovateAge ?? "3 days"}' }],\n}\n`,
  };
  if (o.dockerfile !== false) {
    out["Dockerfile"] =
      `ARG NODE_VERSION=${o.dockerNode ?? "24.21.0"}\nARG PNPM_VERSION="${o.dockerPnpm ?? "12.12.1"}"\nFROM node:\${NODE_VERSION}\n`;
  }
  return out;
}

function failure(o: Overrides): string {
  const report = runPins(tempRepo(files(o)));
  expect(isOk(report)).toBe(false);
  return renderFailure(report);
}

describe("pins", () => {
  it("passes when every copy agrees", () => {
    const report = runPins(tempRepo(files()));
    expect(isOk(report)).toBe(true);
    expect(renderOk(report)).toContain("node 24.21.0, pnpm 12.12.1");
  });

  it("names both files when the Dockerfile node differs from mise", () => {
    const text = failure({ dockerNode: "24.20.0" });
    expect(text).toContain(".mise/config.toml [tools].node = 24.21.0");
    expect(text).toContain("Dockerfile ARG NODE_VERSION = 24.20.0");
  });

  it("fails a pnpm packageManager mismatch", () => {
    expect(failure({ packageManager: "pnpm@12.12.0+sha512.abc" })).toContain(
      "package.json packageManager = 12.12.0",
    );
  });

  it("fails a devEngines pnpm mismatch and a Dockerfile pnpm mismatch", () => {
    expect(failure({ devEnginesVersion: "12.0.0" })).toContain(
      "devEngines.packageManager = 12.0.0",
    );
    expect(failure({ dockerPnpm: "11.0.0" })).toContain("Dockerfile ARG PNPM_VERSION = 11.0.0");
  });

  it("fails an mise pnpm that differs", () => {
    expect(failure({ misePnpm: "12.11.0" })).toContain(".mise/config.toml [tools].pnpm = 12.11.0");
  });

  it("requires mise node to satisfy engines.node", () => {
    expect(failure({ enginesNode: ">=24.22.0" })).toContain("engines.node = >=24.22.0");
    expect(failure({ enginesNode: "^24" })).toContain("not a `>=X.Y.Z` constraint");
  });

  it("requires devEngines onFail to be error", () => {
    expect(failure({ onFail: "warn" })).toContain("onFail");
  });

  it('passes 4320 minutes against "3 days" and fails 1440', () => {
    expect(isOk(runPins(tempRepo(files({ pnpmAge: "4320", renovateAge: "3 days" }))))).toBe(true);
    expect(failure({ pnpmAge: "1440" })).toContain("pnpm-workspace.yaml minimumReleaseAge = 1440");
  });

  it("lets a rule opt out of the soak with an explicit null, but not with a wrong duration", () => {
    const f = files({});
    f[".renovaterc.json5"] = (f[".renovaterc.json5"] ?? "").replace(
      "packageRules: [",
      "packageRules: [{ matchDepNames: ['mirror'], minimumReleaseAge: null }, ",
    );
    expect(isOk(runPins(tempRepo(f)))).toBe(true);
  });

  it("fails an unparseable renovate duration", () => {
    expect(failure({ renovateAge: "soon" })).toContain('"soon"');
  });

  it("raises a layout error (exit 2) when the Dockerfile is absent", () => {
    expect(() => runPins(tempRepo(files({ dockerfile: false })))).toThrow(LayoutError);
    expect(() => runPins(tempRepo(files({ dockerfile: false })))).toThrow(/Dockerfile/);
  });

  it("reads a Dockerfile that is a symlink", () => {
    const f = files({ dockerNode: "24.20.0" });
    const real = f["Dockerfile"] ?? "";
    delete f["Dockerfile"];
    const repo = tempRepo({ ...f, "build/Dockerfile.real": real });
    symlinkSync("build/Dockerfile.real", join(repo.root, "Dockerfile"));
    const report = runPins(repo);
    expect(isOk(report)).toBe(false);
    expect(renderFailure(report)).toContain("Dockerfile ARG NODE_VERSION = 24.20.0");
  });

  it("still fails a Dockerfile with no ARG NODE_VERSION once the file exists", () => {
    const f = files();
    f["Dockerfile"] = "FROM scratch\n";
    expect(() => runPins(tempRepo(f))).toThrow(LayoutError);
  });

  it("raises a layout error for a missing or unparseable file", () => {
    const missing = files();
    delete missing["package.json"];
    expect(() => runPins(tempRepo(missing))).toThrow(LayoutError);
    expect(() => runPins(tempRepo({ ...files(), ".mise/config.toml": "= nope" }))).toThrow(
      LayoutError,
    );
    expect(() => runPins(tempRepo({ ...files(), "pnpm-workspace.yaml": "a: [" }))).toThrow(
      LayoutError,
    );
    expect(() => runPins(tempRepo({ ...files(), ".renovaterc.json5": "{" }))).toThrow(LayoutError);
  });
});
