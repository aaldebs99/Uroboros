import { render } from "@testing-library/react";
import type { Ref } from "react";
import { describe, expect, it, vi } from "vitest";

import { Player } from "./Player";
import PreviewHls from "./PreviewHls";

/**
 * Which engine plays HLS (docs/transcoding.md): hls.js everywhere, the browser's own HLS on Safari
 * and iPhones. Each media is a <video> saying which it is.
 */

function tagged(engine: string) {
  return ({ ref, children }: { ref?: Ref<HTMLVideoElement>; children?: unknown }) => (
    <video ref={ref} data-engine={engine}>
      {children as never}
    </video>
  );
}
vi.mock("@videojs/react/media/hlsjs-video", () => ({ HlsJsVideo: tagged("hls.js") }));
vi.mock("@videojs/react/media/hls-video", () => ({ HlsVideo: tagged("video.js") }));
vi.mock("@videojs/react/media/native-hls-video", () => ({ NativeHlsVideo: tagged("native") }));

const noop = () => undefined;
const player = { title: "t", start: 0, autoPlay: false, seek: null, chapters: [], subtitles: [] };
const callbacks = { onTime: noop, onPause: noop, onEnded: noop };

function engineOf(container: HTMLElement): string | undefined {
  return container.querySelector("video")?.dataset["engine"];
}

describe("HLS playback", () => {
  it("plays a session through hls.js, or natively on Safari and iPhones", () => {
    const mse = render(
      <Player src="/s/master.m3u8" hls={{ native: false }} {...player} {...callbacks} />,
    );
    expect(engineOf(mse.container)).toBe("hls.js");
    mse.unmount();
    const native = render(
      <Player src="/s/master.m3u8" hls={{ native: true }} {...player} {...callbacks} />,
    );
    expect(engineOf(native.container)).toBe("native");
  });

  it("plays a preview's session through hls.js, or natively", () => {
    const frame = { src: "/p/master.m3u8", subtitles: [], onFailed: noop, onEnded: noop };
    const mse = render(<PreviewHls native={false} {...frame} />);
    expect(engineOf(mse.container)).toBe("hls.js");
    mse.unmount();
    expect(engineOf(render(<PreviewHls native {...frame} />).container)).toBe("native");
  });
});
