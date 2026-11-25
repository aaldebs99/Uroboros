import { Music } from "lucide-react";

/**
 * Where an audio file's picture would be (docs/library.md "The item page"): its thumbnail whole,
 * over a blurred, dimmed copy of itself that fills the frame, or a music glyph when it has none.
 *
 * It lies behind the media element, under the skin's poster and controls: a `<video>` with no video
 * track draws nothing, so the artwork shows through it and captions still draw over it. It takes no
 * pointer events, so clicks and gestures reach the player.
 */
export function AudioArtwork({ src }: { src: string | null }) {
  return (
    <div
      aria-hidden="true"
      data-audio-art=""
      className="pointer-events-none absolute inset-0 -z-10 grid place-items-center overflow-hidden rounded-[inherit]"
    >
      {src === null ? (
        <Music className="size-16 text-overlay-foreground opacity-60" />
      ) : (
        <>
          <img
            src={src}
            alt=""
            className="absolute inset-0 size-full scale-110 object-cover opacity-50 blur-2xl"
          />
          <img src={src} alt="" className="relative size-full object-contain" />
        </>
      )}
    </div>
  );
}
