import { HlsJsVideo } from "@videojs/react/media/hlsjs-video";
import { NativeHlsVideo } from "@videojs/react/media/native-hls-video";

import { PreviewFrame, type PreviewFrameProps } from "./PreviewFrame";

/**
 * A preview frame playing a live session's HLS: natively on Safari and iOS, elsewhere through
 * hls.js. Its own module, so tiles load Video.js and hls.js only when a preview needs them.
 */
export default function PreviewHls({
  native,
  ...frame
}: Omit<PreviewFrameProps, "renderMedia"> & { native: boolean }) {
  const Media = native ? NativeHlsVideo : HlsJsVideo;
  return <PreviewFrame {...frame} renderMedia={(props) => <Media {...props} />} />;
}
