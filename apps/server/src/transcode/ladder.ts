/**
 * The quality ladder (docs/transcoding.md): the sizes a viewer can pick, each with a bitrate cap,
 * measured on the short side so a vertical video gets the same rungs as a wide one.
 */

export interface Rung {
  /** Lines on the short side: 1080 is 1920×1080 and 1080×1920 alike. */
  short: number;
  /** The video's bitrate cap, bits per second. */
  bitrate: number;
}

export const RUNGS: readonly Rung[] = [
  { short: 2160, bitrate: 20_000_000 },
  { short: 1440, bitrate: 12_000_000 },
  { short: 1080, bitrate: 8_000_000 },
  { short: 720, bitrate: 4_000_000 },
  { short: 480, bitrate: 1_500_000 },
  { short: 360, bitrate: 800_000 },
];

/** The top rung: the tallest encode, on the short side, unless the server sets a lower one. */
export const MAX_SHORT = 2160;

/**
 * The rungs a source offers: those up to its short side (never an upscale) and the server's
 * tallest encode (`maxShort`).
 */
export function rungsFor(width: number, height: number, maxShort: number = MAX_SHORT): number[] {
  const short = Math.min(width, height, maxShort);
  return RUNGS.filter((r) => r.short <= short).map((r) => r.short);
}

/** The rung whose cap applies to a size: the smallest at or above it, else the top one. */
export function rungFor(short: number): Rung {
  const fits = RUNGS.filter((r) => r.short >= short);
  return fits.at(-1) ?? (RUNGS[0] as Rung);
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** The output size for a rung: the short side scaled to it (never up), aspect kept, both even. */
export function outputSize(
  width: number,
  height: number,
  short: number,
): { width: number; height: number } {
  const scale = Math.min(1, short / Math.min(width, height));
  return { width: even(width * scale), height: even(height * scale) };
}

/** H.264 levels: max frame size in macroblocks and max macroblocks per second (Table A-1). */
const LEVELS = [
  { idc: 30, frame: 1620, rate: 40_500 },
  { idc: 31, frame: 3600, rate: 108_000 },
  { idc: 32, frame: 5120, rate: 216_000 },
  { idc: 40, frame: 8192, rate: 245_760 },
  { idc: 41, frame: 8192, rate: 245_760 },
  { idc: 42, frame: 8704, rate: 522_240 },
  { idc: 50, frame: 22_080, rate: 589_824 },
  { idc: 51, frame: 36_864, rate: 983_040 },
  { idc: 52, frame: 36_864, rate: 2_073_600 },
] as const;

/** Frame rates up to this get the level a size is encoded at. */
const MAX_FPS = 60;

/**
 * The H.264 level for an output size at up to 60 fps, as the encoder's `-level` and the High
 * profile codec string the playlist's CODECS names, so the two always agree.
 */
export function h264Level(width: number, height: number): { idc: number; codec: string } {
  const frame = Math.ceil(width / 16) * Math.ceil(height / 16);
  const level = LEVELS.find((l) => l.frame >= frame && l.rate >= frame * MAX_FPS) ?? LEVELS[8];
  return { idc: level.idc, codec: `avc1.6400${level.idc.toString(16).padStart(2, "0")}` };
}
