/**
 * A tiny fragmented-MP4 writer for tests: just the boxes the transcoder's reader looks at (an
 * init with tracks and timescales, fragments with per-track decode times and the first sample's
 * composition offset), so tests need no real ffmpeg output.
 */

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  return Buffer.concat([u32(body.length + 8), Buffer.from(type, "latin1"), body]);
}

function fullBox(type: string, version: number, flags: number, ...payload: Buffer[]): Buffer {
  return box(type, u32(((version & 0xff) << 24) | (flags & 0xffffff)), ...payload);
}

export interface TestTrack {
  id: number;
  kind: "vide" | "soun";
  timescale: number;
}

function trak(t: TestTrack): Buffer {
  // tkhd v0: creation, modification, track id, reserved, duration, then 60 bytes we leave zero.
  const tkhd = fullBox("tkhd", 0, 3, u32(0), u32(0), u32(t.id), u32(0), u32(0), Buffer.alloc(60));
  // mdhd v0: creation, modification, timescale, duration, language + pre_defined.
  const mdhd = fullBox("mdhd", 0, 0, u32(0), u32(0), u32(t.timescale), u32(0), u32(0));
  const hdlr = fullBox("hdlr", 0, 0, u32(0), Buffer.from(t.kind, "latin1"), Buffer.alloc(13));
  return box("trak", tkhd, box("mdia", mdhd, hdlr));
}

/** ftyp + moov for these tracks. */
export function initSegment(tracks: TestTrack[]): Buffer {
  const ftyp = box(
    "ftyp",
    Buffer.from("isom", "latin1"),
    u32(512),
    Buffer.from("iso6mp41", "latin1"),
  );
  return Buffer.concat([
    ftyp,
    box("moov", fullBox("mvhd", 0, 0, Buffer.alloc(96)), ...tracks.map(trak)),
  ]);
}

export interface TestTraf {
  trackId: number;
  /** Decode time in the track's timescale; negative values are written as two's complement. */
  decodeTime: bigint;
  /** The first sample's composition offset (signed, trun v1). */
  cts?: number;
}

/** moof + mdat: one traf per track, with a tfdt (v1) and a one-sample trun. */
export function fragment(seq: number, trafs: TestTraf[], payload = Buffer.from("data")): Buffer {
  const parts = trafs.map((t) => {
    const tfhd = fullBox("tfhd", 0, 0x020000, u32(t.trackId));
    const time = Buffer.alloc(8);
    time.writeBigInt64BE(t.decodeTime);
    const tfdt = fullBox("tfdt", 1, 0, time);
    const cts = Buffer.alloc(4);
    cts.writeInt32BE(t.cts ?? 0);
    // flags: data offset (0x1), sample duration (0x100), composition offsets (0x800).
    const trun = fullBox("trun", 1, 0x000901, u32(1), u32(0), u32(1000), cts);
    return box("traf", tfhd, tfdt, trun);
  });
  return Buffer.concat([
    box("moof", fullBox("mfhd", 0, 0, u32(seq)), ...parts),
    box("mdat", payload),
  ]);
}
