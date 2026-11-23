import { describe, expect, it } from "vitest";

import { countPixels, evaluatePixels, isGovernedUi, MARKER, measurePixels } from "./pixels.ts";
import { isOk, renderFailure } from "./report.ts";
import { tempRepo } from "./testRepo.ts";

const reason = "the browser's own viewport width, in device pixels";

describe("countPixels", () => {
  it.each([
    ['className="rounded-[12px]"', 1],
    ["width: .5px;", 1],
    ["shadow-[0_0_12px] shadow-[0_1px_2px_oklch(0.2_0.1_250/6%)]", 2],
    ["box-shadow: 0 0 6px, 0 8px 24px;", 3],
    ["border: 1px solid; margin: 0px;", 0],
    ["border-width: 1.5px; gap: 10px; inset: 01px;", 3],
    ["height: 12rem; width: 12 px; font: 0.875rem;", 0],
    ["calc(3.625rem+env(safe-area-inset-bottom))", 0],
    ["// a 12-pixel line, not a 12px one", 1],
  ])("%s → %i", (text, expected) => {
    expect(countPixels(text)).toBe(expected);
  });

  it("skips a line carrying the marker with a reason, and only that line", () => {
    const text = [`width: 600px; /* ${MARKER} ${reason} */`, "height: 300px;"].join("\n");
    expect(countPixels(text)).toBe(1);
  });

  it("does not skip a line with a bare or short marker", () => {
    expect(countPixels(`width: 600px; /* ${MARKER} */`)).toBe(1);
    expect(countPixels(`width: 600px; // ${MARKER} needed`)).toBe(1);
  });
});

describe("isGovernedUi", () => {
  it.each([
    ["apps/web/src/index.css", true],
    ["apps/web/src/library/Player.tsx", true],
    ["apps/web/src/lib/uiScale.ts", true],
    ["apps/web/src/lib/uiScale.test.ts", false],
    ["apps/web/src/library/Player.spec.tsx", false],
    ["apps/web/src/__tests__/a.tsx", false],
    ["apps/web/src/generated/a.ts", false],
    ["apps/web/src/notes.md", false],
    ["apps/web/vite.config.ts", false],
    ["apps/server/src/a.ts", false],
  ])("%s → %s", (path, expected) => {
    expect(isGovernedUi(path)).toBe(expected);
  });
});

describe("measurePixels and evaluatePixels", () => {
  it("measures every governed file, zeros included", () => {
    const repo = tempRepo({
      "apps/web/src/a.css": ".a { width: 12px; }\n",
      "apps/web/src/b.tsx": 'export const B = () => <div className="w-42" />;\n',
      "apps/web/src/b.test.tsx": "width: 12px;\n",
      "apps/server/src/c.ts": "const w = '12px';\n",
    });
    expect(measurePixels(repo)).toEqual(
      new Map([
        ["apps/web/src/a.css", 1],
        ["apps/web/src/b.tsx", 0],
      ]),
    );
  });

  it("fails a new pixel value, naming the file, and passes a frozen one at its exact count", () => {
    const measured = new Map([
      ["apps/web/src/a.css", 2],
      ["apps/web/src/b.tsx", 0],
    ]);
    const failed = renderFailure(evaluatePixels(measured, [], 1));
    expect(failed).toContain("hard-coded pixel values");
    expect(failed).toContain("apps/web/src/a.css");
    const frozen = (value: number) => [{ key: "apps/web/src/a.css", value, reason }];
    expect(isOk(evaluatePixels(measured, frozen(2), 1))).toBe(true);
    expect(renderFailure(evaluatePixels(measured, frozen(3), 1))).toContain("(slack)");
  });
});
