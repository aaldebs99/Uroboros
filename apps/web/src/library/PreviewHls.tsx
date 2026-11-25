import { HlsVideo } from "@videojs/react/media/hls-video";
import { NativeHlsVideo } from "@videojs/react/media/native-hls-video";

import { PreviewFrame, type PreviewFrameProps } from "./PreviewFrame";

/**
 * A preview frame playing a live session's HLS: natively on Safari and iOS, elsewhere through
 * Video.js's engine. Its own module, so tiles load Video.js only when a preview needs it.
 */
export default function PreviewHls({
  native,
  ...frame
}: Omit<PreviewFrameProps, "renderMedia"> & { native: boolean }) {
  const Media = native ? NativeHlsVideo : HlsVideo;
  return <PreviewFrame {...frame} renderMedia={(props) => <Media {...props} />} />;
}
