import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderNotices } from "./notices.ts";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "uroboros-notices-"));
  await mkdir(join(root, "a"));
  await writeFile(join(root, "a", "LICENSE"), "MIT License\n\nCopyright (c) A\n");
  await writeFile(join(root, "a", "license.js"), "not a licence");
  await mkdir(join(root, "font"));
  await writeFile(join(root, "font", "LICENSE.md"), "SIL OPEN FONT LICENSE Version 1.1\n");
  await writeFile(join(root, "font", "NOTICE"), "font notice\n");
  await mkdir(join(root, "bare"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("renderNotices", () => {
  it("lists each package once, sorted, with its licence texts", () => {
    const text = renderNotices({
      MIT: [
        { name: "zeta", versions: ["2.0.0"], paths: [join(root, "bare")], license: "MIT" },
        {
          name: "alpha",
          versions: ["1.0.0"],
          paths: [join(root, "a")],
          license: "MIT",
          homepage: "https://alpha.example",
        },
      ],
      "OFL-1.1": [
        { name: "@f/font", versions: ["5.3.0"], paths: [join(root, "font")], license: "OFL-1.1" },
      ],
    });
    const alpha = text.indexOf("alpha@1.0.0");
    const font = text.indexOf("@f/font@5.3.0");
    const zeta = text.indexOf("zeta@2.0.0");
    expect(font).toBeGreaterThan(-1);
    expect(alpha).toBeGreaterThan(font);
    expect(zeta).toBeGreaterThan(alpha);
    expect(text).toContain("Copyright (c) A");
    expect(text).toContain("https://alpha.example");
    expect(text).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(text).toContain("font notice");
    expect(text).not.toContain("not a licence");
    expect(text.slice(zeta)).toMatch(/no licence file.*MIT/i);
  });

  it("refuses an empty report", () => {
    expect(() => renderNotices({})).toThrow(/no packages/);
  });
});
