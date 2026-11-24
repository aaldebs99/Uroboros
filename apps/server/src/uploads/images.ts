/** The thumbnail images an upload or an edit takes, known by their first bytes, not their type. */

const SIGNATURES: readonly { ext: "jpg" | "png" | "webp"; test: (b: Uint8Array) => boolean }[] = [
  { ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: "png",
    test: (b) =>
      Buffer.from(b.subarray(0, 8)).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
  },
  {
    ext: "webp",
    test: (b) =>
      Buffer.from(b.subarray(0, 4)).toString("latin1") === "RIFF" &&
      Buffer.from(b.subarray(8, 12)).toString("latin1") === "WEBP",
  },
];

/** The image's extension (jpg, png or webp), or null for anything else. */
export function imageExt(bytes: Uint8Array): "jpg" | "png" | "webp" | null {
  return SIGNATURES.find((s) => s.test(bytes))?.ext ?? null;
}
