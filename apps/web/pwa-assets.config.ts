/**
 * PWA icon generation, run by `mise run icons` through a pinned `pnpm dlx`; the generator is not a
 * dependency (it pulls in sharp, a native module). The source of truth is
 * `assets/logos/uroboros-transparent.svg`: the task copies it to `public/uroboros.svg` first, and
 * the generator writes its PNGs beside that copy. The output is committed.
 *
 * A plain object rather than the generator's `defineConfig`, because nothing from that package
 * resolves from here under dlx. The background of the maskable and Apple icons is the shell's
 * dark sidebar (`--sidebar` in `.dark`, oklch(0.12 0.03 257)), the manifest's theme colour.
 */
export default {
  headLinkOptions: { preset: "2023" },
  preset: {
    transparent: {
      sizes: [64, 192, 512],
      padding: 0.05,
      resizeOptions: { fit: "contain", background: "transparent" },
      favicons: [[48, "favicon.ico"]],
    },
    maskable: {
      sizes: [512],
      padding: 0.05,
      resizeOptions: { fit: "contain", background: "#010611" },
    },
    apple: {
      sizes: [180],
      padding: 0.05,
      resizeOptions: { fit: "contain", background: "#010611" },
    },
  },
  images: ["public/uroboros.svg"],
};
