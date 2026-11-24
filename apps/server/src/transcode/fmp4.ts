/**
 * Reads ffmpeg's fragmented MP4 as it streams out (docs/transcoding.md): the init (ftyp + moov)
 * once, then each fragment (moof + mdat) with every track's decode time and first composition
 * offset, so a session can put fragments into the segments its playlist promised.
 */

export interface TrackInfo {
  /** The handler: "vide" or "soun". */
  kind: string;
  timescale: number;
}

export interface Init {
  kind: "init";
  bytes: Buffer;
  tracks: Map<number, TrackInfo>;
}

export interface TrafTiming {
  decodeTime: bigint;
  /** The first sample's composition offset, in the track's timescale. */
  cts: number;
}

export interface Fragment {
  kind: "fragment";
  bytes: Buffer;
  trafs: Map<number, TrafTiming>;
  timescales: ReadonlyMap<number, number>;
}

interface Box {
  type: string;
  /** Offset of the body (after the header), relative to the buffer. */
  body: number;
  end: number;
}

function* children(buf: Buffer, start: number, end: number): Generator<Box> {
  let at = start;
  while (at + 8 <= end) {
    let size = buf.readUInt32BE(at);
    let header = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(at + 8));
      header = 16;
    }
    if (size < header) return;
    yield { type: buf.toString("latin1", at + 4, at + 8), body: at + header, end: at + size };
    at += size;
  }
}

const child = (buf: Buffer, box: Box, type: string) =>
  [...children(buf, box.body, box.end)].find((b) => b.type === type);

/** Offset of a full box's field after version/flags, for v0 and v1 layouts. */
const field = (buf: Buffer, box: Box, v0: number, v1: number) =>
  box.body + (buf[box.body] === 1 ? v1 : v0);

function readTracks(moov: Buffer): Map<number, TrackInfo> {
  const tracks = new Map<number, TrackInfo>();
  for (const trak of children(moov, 8, moov.length)) {
    if (trak.type !== "trak") continue;
    const tkhd = child(moov, trak, "tkhd");
    const mdia = child(moov, trak, "mdia");
    const mdhd = mdia && child(moov, mdia, "mdhd");
    const hdlr = mdia && child(moov, mdia, "hdlr");
    if (!tkhd || !mdhd || !hdlr) continue;
    tracks.set(moov.readUInt32BE(field(moov, tkhd, 12, 20)), {
      kind: moov.toString("latin1", hdlr.body + 8, hdlr.body + 12),
      timescale: moov.readUInt32BE(field(moov, mdhd, 12, 20)),
    });
  }
  return tracks;
}

/** The first sample's composition offset from a trun, or 0 without one. */
function firstCts(buf: Buffer, trun: Box): number {
  const flags = buf.readUInt32BE(trun.body) & 0xffffff;
  if ((flags & 0x800) === 0 || buf.readUInt32BE(trun.body + 4) === 0) return 0;
  let at = trun.body + 8;
  for (const [flag, size] of [
    [0x1, 4],
    [0x4, 4],
    [0x100, 4],
    [0x200, 4],
    [0x400, 4],
  ] as const) {
    if (flags & flag) at += size;
  }
  return buf[trun.body] === 1 ? buf.readInt32BE(at) : buf.readUInt32BE(at);
}

/** Every traf's timing; a negative decode time (encoder priming) is written back as 0. */
function readTrafs(moof: Buffer): Map<number, TrafTiming> {
  const trafs = new Map<number, TrafTiming>();
  for (const traf of children(moof, 8, moof.length)) {
    if (traf.type !== "traf") continue;
    const tfhd = child(moof, traf, "tfhd");
    const tfdt = child(moof, traf, "tfdt");
    if (!tfhd || !tfdt) continue;
    let decodeTime: bigint;
    if (moof[tfdt.body] === 1) {
      decodeTime = moof.readBigInt64BE(tfdt.body + 4);
      if (decodeTime < 0n) {
        moof.writeBigInt64BE(0n, tfdt.body + 4);
        decodeTime = 0n;
      }
    } else {
      decodeTime = BigInt(moof.readUInt32BE(tfdt.body + 4));
    }
    const trun = child(moof, traf, "trun");
    trafs.set(moof.readUInt32BE(tfhd.body + 4), {
      decodeTime,
      cts: trun ? firstCts(moof, trun) : 0,
    });
  }
  return trafs;
}

/** A track's presentation time in a fragment, in seconds, or null if it has no samples there. */
export function presentationTime(f: Fragment, trackId: number): number | null {
  const traf = f.trafs.get(trackId);
  const timescale = f.timescales.get(trackId);
  if (traf === undefined || timescale === undefined) return null;
  return (Number(traf.decodeTime) + traf.cts) / timescale;
}

/** Splits a fragmented MP4 byte stream into its init and fragments, whatever the chunking. */
export class Fmp4Reader {
  #chunks: Buffer[] = [];
  #length = 0;
  #initParts: Buffer[] = [];
  #timescales: Map<number, number> | null = null;
  #fragment: { parts: Buffer[]; trafs: Map<number, TrafTiming> } | null = null;

  push(chunk: Buffer): (Init | Fragment)[] {
    this.#chunks.push(chunk);
    this.#length += chunk.length;
    const out: (Init | Fragment)[] = [];
    for (let box = this.#take(); box !== null; box = this.#take()) {
      const done = this.#onBox(box);
      if (done !== null) out.push(done);
    }
    return out;
  }

  /** The next whole top-level box, or null until its bytes are all here. */
  #take(): Buffer | null {
    if (this.#length < 16 && (this.#length < 8 || this.#peek().readUInt32BE(0) === 1)) return null;
    const head = this.#peek();
    const small = head.readUInt32BE(0);
    const size = small === 1 ? Number(head.readBigUInt64BE(8)) : small;
    if (size < 8) throw new Error(`a malformed MP4 box (size ${String(size)})`);
    if (this.#length < size) return null;
    const all = Buffer.concat(this.#chunks, this.#length);
    this.#chunks = size < all.length ? [all.subarray(size)] : [];
    this.#length -= size;
    return Buffer.from(all.subarray(0, size));
  }

  #peek(): Buffer {
    const first = this.#chunks[0] as Buffer;
    return first.length >= 16 || this.#chunks.length === 1
      ? first
      : Buffer.concat(this.#chunks, Math.min(this.#length, 16));
  }

  #onBox(box: Buffer): Init | Fragment | null {
    const type = box.toString("latin1", 4, 8);
    if (this.#timescales === null) {
      this.#initParts.push(box);
      if (type === "moof" || type === "mdat") throw new Error("a fragment before its init");
      if (type !== "moov") return null;
      const tracks = readTracks(box);
      this.#timescales = new Map([...tracks].map(([id, t]) => [id, t.timescale]));
      return { kind: "init", bytes: Buffer.concat(this.#initParts), tracks };
    }
    if (type === "moof") this.#fragment = { parts: [box], trafs: readTrafs(box) };
    else if (this.#fragment !== null) this.#fragment.parts.push(box);
    if (type !== "mdat" || this.#fragment === null) return null;
    const { parts, trafs } = this.#fragment;
    this.#fragment = null;
    return { kind: "fragment", bytes: Buffer.concat(parts), trafs, timescales: this.#timescales };
  }
}
