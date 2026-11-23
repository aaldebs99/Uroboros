import type { StorageConfig } from "./config.ts";
import { createFilesystemStore } from "./filesystem.ts";
import { createS3Store } from "./s3.ts";
import type { MediaStore } from "./store.ts";

export type { MediaStore, OpenedFile } from "./store.ts";
export {
  renditionKey,
  sidecarKey,
  sanitizeSegment,
  renderLayout,
  type MediaNames,
} from "./layout.ts";

export function createStore(config: StorageConfig): MediaStore {
  return config.kind === "s3" ? createS3Store(config) : createFilesystemStore(config.root);
}
