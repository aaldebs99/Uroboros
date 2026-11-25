/**
 * What ffmpeg may read a downloaded or stored file as. ffmpeg picks a demuxer by a file's
 * contents, not its name, so a link that serves a DASH or HLS playlist as `video/mp4` would
 * otherwise be read as one, and open whatever files or URLs it names (another person's stored
 * video, an internal address). Every input of such a file names these containers, those yt-dlp
 * writes and a profile may convert to; an upload is held to its own, narrower list.
 */
export const MEDIA_FORMATS = "mov,matroska,avi,mpegts,flv,ogg,mp3,aac,flac,wav,gif";

/**
 * yt-dlp's ffmpeg post-processors also read the subtitles, thumbnails and chapter metadata they
 * embed or convert.
 */
export const POSTPROCESSOR_FORMATS = `${MEDIA_FORMATS},image2,jpeg_pipe,png_pipe,webp_pipe,mjpeg,webvtt,srt,ass,lrc,ffmetadata`;
