import { describe, expect, it } from "vitest";
import { fragment, initSegment } from "../../test/fmp4.ts";
import { Fmp4Reader, type Fragment } from "./fmp4.ts";
import { Segmenter } from "./segmenter.ts";

const TS = 1000;
const reader = new Fmp4Reader();
reader.push(
  initSegment([
    { id: 1, kind: "vide", timescale: TS },
    { id: 2, kind: "soun", timescale: 48000 },
  ]),
);

/** A fragment whose video starts at `t` seconds. */
function frag(t: number, seq = 0): Fragment {
  const [f] = reader.push(
    fragment(seq, [
      { trackId: 1, decodeTime: BigInt(Math.round(t * TS)) },
      { trackId: 2, decodeTime: 0n },
    ]),
  );
  return f as Fragment;
}

const boundaries = [0, 6, 12, 18, 20];
const newSegmenter = (first: number) => new Segmenter({ boundaries, trackId: 1, first });

describe("Segmenter", () => {
  it("groups fragments into segments and finishes one when the next begins", () => {
    const s = newSegmenter(0);
    expect(s.push(frag(0))).toEqual([]);
    expect(s.push(frag(2.5))).toEqual([]);
    const done = s.push(frag(6));
    expect(done.map((d) => d.index)).toEqual([0]);
    expect(done[0]?.bytes.length).toBe(frag(0).bytes.length + frag(2.5).bytes.length);
    expect(s.push(frag(12)).map((d) => d.index)).toEqual([1]);
    expect(s.end()?.index).toBe(2);
    expect(s.end()).toBeNull();
  });

  it("takes a keyframe a hair before its boundary as the boundary's", () => {
    const s = newSegmenter(0);
    s.push(frag(0));
    expect(s.push(frag(5.9995)).map((d) => d.index)).toEqual([0]);
  });

  it("drops what comes before the run's first segment", () => {
    const s = newSegmenter(2);
    expect(s.push(frag(10))).toEqual([]);
    s.push(frag(12));
    s.push(frag(15));
    const done = s.push(frag(18));
    expect(done.map((d) => d.index)).toEqual([2]);
    expect(done[0]?.bytes.length).toBe(2 * frag(12).bytes.length);
  });

  it("reports where the run is", () => {
    const s = newSegmenter(1);
    expect(s.current).toBeNull();
    s.push(frag(6));
    expect(s.current).toBe(1);
    s.push(frag(12));
    expect(s.current).toBe(2);
  });

  it("keeps a fragment without the reference track in the segment it follows", () => {
    const s = newSegmenter(0);
    s.push(frag(0));
    const [audioOnly] = reader.push(fragment(9, [{ trackId: 2, decodeTime: 300000n }]));
    expect(s.push(audioOnly as Fragment)).toEqual([]);
    expect(s.end()?.bytes.length).toBe(frag(0).bytes.length + (audioOnly as Fragment).bytes.length);
  });

  it("keeps a later run's pre-roll in its first segment when asked (an audio file's run)", () => {
    const s = new Segmenter({ boundaries, trackId: 1, first: 2, preroll: 0.25 });
    expect(s.push(frag(11.7))).toEqual([]);
    expect(s.current).toBeNull();
    s.push(frag(11.76));
    expect(s.current).toBe(2);
    s.push(frag(12.5));
    const done = s.push(frag(18));
    expect(done.map((d) => d.index)).toEqual([2]);
    expect(done[0]?.bytes.length).toBe(2 * frag(12).bytes.length);
  });
});
