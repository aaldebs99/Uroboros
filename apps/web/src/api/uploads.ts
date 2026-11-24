import { type NewUploadBody, Upload } from "@uroboros/contract";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { deleteJson, getJson, postJson, putBytesWithProgress } from "./client";

/** Uploads (docs/uploads.md): start one, send its parts, complete or cancel it. */

export const uploadsKey = ["api", "uploads"] as const;

const path = (id: string, rest = "") => `/api/uploads/${encodeURIComponent(id)}${rest}`;

export const createUpload = (body: NewUploadBody) => postJson("/api/uploads", Upload, body);
export const getUpload = (id: string, signal?: AbortSignal) =>
  getJson(path(id), Upload, signal === undefined ? undefined : { signal });
export const completeUpload = (id: string) => postJson(path(id, "/complete"), Upload);
export const removeUpload = (id: string) => deleteJson(path(id));

export const sendPart = (
  id: string,
  n: number,
  part: Blob,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
) =>
  putBytesWithProgress(path(id, `/parts/${String(n)}`), part, {
    onProgress,
    signal,
  });

export const sendThumbnail = (id: string, image: Blob, signal: AbortSignal) =>
  putBytesWithProgress(path(id, "/thumbnail"), image, { signal });

/** The person's unfinished and failed uploads, asked again every 3 s while any is unfinished. */
export function useUploadList() {
  return useQuery({
    queryKey: uploadsKey,
    queryFn: ({ signal }) => getJson("/api/uploads", z.array(Upload), { signal }),
    refetchInterval: (query) =>
      query.state.data?.some((u) => u.state === "receiving" || u.state === "processing") === true
        ? 3000
        : false,
  });
}
