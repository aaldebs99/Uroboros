import { describe, expect, it } from "vitest";
import { fragment, initSegment } from "../../test/fmp4.ts";
import { Fmp4Reader, type Fragment, presentationTime } from "./fmp4.ts";

const tracks = [
  { id: 1, kind: "vide" as const, timescale: 12288 },
  { id: 2, kind: "soun" as const, timescale: 48000 },
];

function read(chunks: Buffer[]) {
  const reader = new Fmp4Reader();
  return chunks.flatMap((c) => reader.push(c));
}

describe("Fmp4Reader", () => {
  it("splits the init from the fragments, whatever the chunking", () => {
    const init = initSegment(tracks);
    const f1 = fragment(1, [
      { trackId: 1, decodeTime: 0n },
      { trackId: 2, decodeTime: 0n },
    ]);
    const f2 = fragment(2, [
      { trackId: 1, decodeTime: 73728n },
      { trackId: 2, decodeTime: 288000n },
    ]);
    const all = Buffer.concat([init, f1, f2]);
    const whole = read([all]);
    const bytewise = read([...all].map((b) => Buffer.from([b])));
    for (const out of [whole, bytewise]) {
      expect(out.map((o) => o.kind)).toEqual(["init", "fragment", "fragment"]);
      expect(out[0]?.bytes.equals(init)).toBe(true);
      expect(out[1]?.bytes.equals(f1)).toBe(true);
      expect(out[2]?.bytes.equals(f2)).toBe(true);
    }
  });

  it("reads each track's kind and timescale from the init", () => {
    const [init] = read([initSegment(tracks)]);
    expect(init?.kind === "init" && init.tracks).toEqual(
      new Map([
        [1, { kind: "vide", timescale: 12288 }],
        [2, { kind: "soun", timescale: 48000 }],
      ]),
    );
  });

  it("reports a fragment's presentation time per track, composition offset included", () => {
    const out = read([
      initSegment(tracks),
      fragment(1, [
        { trackId: 1, decodeTime: 73728n - 512n, cts: 512 },
        { trackId: 2, decodeTime: 287000n },
      ]),
    ]);
    const f = out[1] as Fragment;
    expect(presentationTime(f, 1)).toBe(6);
    expect(presentationTime(f, 2)).toBeCloseTo(5.979, 3);
    expect(presentationTime(f, 3)).toBeNull();
  });

  it("clamps a negative decode time (encoder priming) to 0 in the bytes too", () => {
    const out = read([
      initSegment(tracks),
      fragment(1, [
        { trackId: 1, decodeTime: 0n },
        { trackId: 2, decodeTime: -1024n },
      ]),
    ]);
    const f = out[1] as Fragment;
    expect(presentationTime(f, 2)).toBe(0);
    const again = read([initSegment(tracks), f.bytes])[1] as Fragment;
    expect(presentationTime(again, 2)).toBe(0);
  });

  it("refuses a fragment before any init", () => {
    expect(() => read([fragment(1, [{ trackId: 1, decodeTime: 0n }])])).toThrow(/before its init/);
  });
});
