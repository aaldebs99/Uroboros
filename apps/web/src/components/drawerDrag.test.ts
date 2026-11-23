import { describe, expect, it } from "vitest";

import { FLICK, REST, SLOP, begin, move, offset, progress, settle, velocity } from "./drawerDrag";

const at = (x: number, y = 0, t = 0) => ({ x, y, t });

describe("drawerDrag", () => {
  it("waits until the finger has moved SLOP before judging", () => {
    const drag = move(begin("closed", at(100)), at(100 + SLOP - 1, 0, 10));
    expect(drag.axis).toBe("pending");
  });

  it("locks sideways when across is twice down, and gives a scroll back", () => {
    expect(move(begin("closed", at(100)), at(100 + SLOP * 2, SLOP - 1, 10)).axis).toBe(
      "horizontal",
    );
    expect(move(begin("closed", at(100)), at(102, SLOP, 10)).axis).toBe("none");
  });

  it("ignores a push on a closed drawer further shut, but drags an open one shut", () => {
    expect(move(begin("closed", at(100)), at(100 - SLOP, 0, 10)).axis).toBe("none");
    expect(move(begin("open", at(100)), at(100 - SLOP * 2, 0, 10)).axis).toBe("horizontal");
  });

  it("refuses a sample older than the last", () => {
    const drag = move(begin("closed", at(100, 0, 50)), at(140, 0, 40));
    expect(offset(drag)).toBe(0);
  });

  it("reads a throw's speed, and none after the finger rested", () => {
    let drag = begin("closed", at(0, 0, 0));
    drag = move(drag, at(20, 0, 10));
    drag = move(drag, at(60, 0, 50));
    expect(velocity(drag, 50)).toBeCloseTo(1.2);
    expect(velocity(drag, 50 + REST + 1)).toBe(0);
  });

  it("measures how much shows and settles on the nearer side unless thrown", () => {
    expect(progress("closed", 120, 240)).toBe(0.5);
    expect(progress("open", -60, 240)).toBe(0.75);
    expect(progress("closed", 500, 240)).toBe(1);
    expect(settle(0.5, 0)).toBe("open");
    expect(settle(0.49, 0)).toBe("closed");
    expect(settle(0.2, FLICK)).toBe("open");
    expect(settle(0.9, -FLICK)).toBe("closed");
  });
});
