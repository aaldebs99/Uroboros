/** A stored file's bytes, from the start or a range. */
export interface OpenedFile {
  body: ReadableStream<Uint8Array>;
  /** The whole file's size, whatever range was asked for. */
  size: number;
  contentType: string | null;
}

/** Where media lives: S3 (opaque keys) or a filesystem (organized folders). docs/downloads.md. */
export interface MediaStore {
  /** Stores a local file under `key`, replacing what was there. */
  put(key: string, file: string, contentType: string): Promise<{ size: number }>;
  /** `range.end` is inclusive. */
  open(key: string, range?: { start: number; end?: number }): Promise<OpenedFile>;
  stat(key: string): Promise<{ size: number } | null>;
  /** Removes `key`; a missing key is fine. */
  delete(key: string): Promise<void>;
  /** A URL a browser can fetch the file from directly, or null to stream it through the api. */
  downloadUrl(key: string, filename: string): Promise<string | null>;
}
