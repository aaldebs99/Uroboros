/** A stored file's bytes, from the start or a range. */
export interface OpenedFile {
  body: ReadableStream<Uint8Array>;
  /** The whole file's size, whatever range was asked for. */
  size: number;
  contentType: string | null;
}

/** A part written by `putPart`, as `completeUpload` needs it back. */
export interface StoredPart {
  n: number;
  etag: string;
  /** S3's CRC32 of the part (base64), sent back on completion; null on the filesystem. */
  checksum: string | null;
}

/** Where media lives: S3 (opaque keys) or a filesystem (organized folders). docs/downloads.md. */
export interface MediaStore {
  /**
   * Starts writing `key` in parts (an upload from a browser, docs/uploads.md): S3's multipart
   * upload, or a temp file beside the target. Returns the upload's id.
   */
  startUpload(key: string, contentType: string): Promise<string>;
  /**
   * Writes part `n` (1-based) at byte `offset`, in any order, from any replica. Refused once the
   * upload was aborted or completed.
   */
  putPart(
    key: string,
    uploadId: string,
    n: number,
    offset: number,
    bytes: Uint8Array,
  ): Promise<Omit<StoredPart, "n">>;
  /**
   * Puts the parts together under `key`. Refused (leaving the upload as it was) unless they add
   * up to `size`; done again once `key` holds `size` bytes, so a retry is harmless.
   */
  completeUpload(
    key: string,
    uploadId: string,
    parts: StoredPart[],
    size: number,
  ): Promise<{ size: number }>;
  /** Drops an unfinished upload and what it wrote; an upload already gone is fine. */
  abortUpload(key: string, uploadId: string): Promise<void>;
  /** Stores a local file under `key`, replacing what was there. */
  put(key: string, file: string, contentType: string): Promise<{ size: number }>;
  /** Stores bytes under `key` (a playback session's segment), replacing what was there. */
  putBytes(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** `range.end` is inclusive. */
  open(key: string, range?: { start: number; end?: number }): Promise<OpenedFile>;
  stat(key: string): Promise<{ size: number } | null>;
  /** Removes `key`; a missing key is fine. */
  delete(key: string): Promise<void>;
  /** A URL a browser can fetch the file from directly, or null to stream it through the api. */
  downloadUrl(key: string, filename: string): Promise<string | null>;
  /** Removes every key under `prefix` (which ends in `/`); none is fine. */
  deletePrefix(prefix: string): Promise<void>;
  /** The file's path on this machine (the filesystem backend), or null (S3). */
  localPath(key: string): string | null;
  /**
   * A URL the transcoder's ffmpeg can read the file from on the store's own endpoint (S3: an
   * internal presigned GET, never the public one), or null where `localPath` has it.
   */
  readUrl(key: string): Promise<string | null>;
}
