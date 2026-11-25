import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  type DeleteObjectsCommandOutput,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageConfig } from "./config.ts";
import { checkParts } from "./parts.ts";
import type { MediaStore } from "./store.ts";

type S3Config = Extract<StorageConfig, { kind: "s3" }>;

/** Presigned download URLs live this long, in seconds. */
export const PRESIGN_SECONDS = 15 * 60;
/** The transcoder's read URLs live this long, in seconds: a run reading a long film. */
export const READ_URL_SECONDS = 6 * 60 * 60;

function client(config: S3Config, endpoint: string): S3Client {
  return new S3Client({
    endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
}

function isNoSuchUpload(err: unknown): boolean {
  return (err as { name?: string }).name === "NoSuchUpload" || isNotFound(err);
}

/** "bytes 2-5/10" → 10. */
function totalOf(contentRange: string | undefined, fallback: number): number {
  const total = contentRange?.split("/")[1];
  return total === undefined || total === "*" ? fallback : Number(total);
}

/**
 * Throws when a DeleteObjects batch left keys behind (Quiet mode reports only those), so a prefix
 * in the trash stays there for the reaper's next pass instead of being dropped half-deleted.
 */
export function checkDeleted(result: Pick<DeleteObjectsCommandOutput, "Errors">): void {
  const errors = result.Errors ?? [];
  if (errors.length === 0) return;
  const which = errors
    .slice(0, 5)
    .map((e) => `${e.Key ?? "?"} (${e.Code ?? "?"})`)
    .join(", ");
  throw new Error(`S3 could not delete ${String(errors.length)} keys: ${which}`);
}

/** An S3-compatible bucket with opaque keys; multipart uploads for large files. */
export function createS3Store(config: S3Config): MediaStore {
  const s3 = client(config, config.endpoint);
  const signer = config.publicUrl === null ? null : client(config, config.publicUrl);
  const Bucket = config.bucket;
  const sizeOf = async (key: string): Promise<number | null> => {
    try {
      return (await s3.send(new HeadObjectCommand({ Bucket, Key: key }))).ContentLength ?? 0;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  };
  /** The bytes an unfinished upload's parts hold, as S3 lists them. */
  const uploadedBytes = async (key: string, uploadId: string): Promise<number> => {
    let total = 0;
    let marker: string | undefined;
    do {
      const page = await s3.send(
        new ListPartsCommand({ Bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }),
      );
      for (const part of page.Parts ?? []) total += part.Size ?? 0;
      marker = page.IsTruncated === true ? page.NextPartNumberMarker : undefined;
    } while (marker !== undefined);
    return total;
  };
  const put: MediaStore["put"] = async (key, file, contentType) => {
    await new Upload({
      client: s3,
      params: { Bucket, Key: key, Body: createReadStream(file), ContentType: contentType },
    }).done();
    return { size: (await stat(file)).size };
  };
  return {
    // CRC32 checksums on every part, as lib-storage's managed uploads send them.
    async startUpload(key, contentType) {
      const res = await s3.send(
        new CreateMultipartUploadCommand({
          Bucket,
          Key: key,
          ContentType: contentType,
          ChecksumAlgorithm: "CRC32",
        }),
      );
      if (res.UploadId === undefined) throw new Error(`S3 gave no upload id for ${key}`);
      return res.UploadId;
    },
    async putPart(key, uploadId, n, _offset, bytes) {
      const res = await s3.send(
        new UploadPartCommand({
          Bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: n,
          Body: bytes,
          ContentLength: bytes.length,
          ChecksumAlgorithm: "CRC32",
        }),
      );
      if (res.ETag === undefined) throw new Error(`S3 gave no ETag for part ${String(n)}`);
      return { etag: res.ETag, checksum: res.ChecksumCRC32 ?? null };
    },
    async completeUpload(key, uploadId, parts, size) {
      const sorted = checkParts(parts);
      let held: number;
      try {
        held = await uploadedBytes(key, uploadId);
      } catch (err) {
        if (!isNoSuchUpload(err)) throw err;
        // Completed already (a retry), or aborted.
        if ((await sizeOf(key)) === size) return { size };
        throw new Error(`no upload ${uploadId} for ${key}`, { cause: err });
      }
      if (held !== size) {
        throw new Error(`the parts of ${key} hold ${String(held)} bytes, not ${String(size)}`);
      }
      await s3.send(
        new CompleteMultipartUploadCommand({
          Bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: sorted.map((p) => ({
              PartNumber: p.n,
              ETag: p.etag,
              ...(p.checksum === null ? {} : { ChecksumCRC32: p.checksum }),
            })),
          },
        }),
      );
      return { size };
    },
    async abortUpload(key, uploadId) {
      try {
        await s3.send(new AbortMultipartUploadCommand({ Bucket, Key: key, UploadId: uploadId }));
      } catch (err) {
        if (!isNoSuchUpload(err)) throw err;
      }
    },
    put,
    // A bucket takes a local file only by uploading it.
    move: put,
    async putBytes(key, bytes, contentType) {
      await s3.send(
        new PutObjectCommand({ Bucket, Key: key, Body: bytes, ContentType: contentType }),
      );
    },
    async open(key, range) {
      const Range =
        range === undefined
          ? undefined
          : `bytes=${String(range.start)}-${range.end === undefined ? "" : String(range.end)}`;
      const res = await s3.send(new GetObjectCommand({ Bucket, Key: key, Range }));
      if (res.Body === undefined) throw new Error(`empty body for ${key}`);
      return {
        body: res.Body.transformToWebStream() as ReadableStream<Uint8Array>,
        size: totalOf(res.ContentRange, res.ContentLength ?? 0),
        contentType: res.ContentType ?? null,
      };
    },
    async stat(key) {
      const size = await sizeOf(key);
      return size === null ? null : { size };
    },
    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async downloadUrl(key, filename) {
      if (signer === null) return null;
      const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
      return getSignedUrl(
        signer,
        new GetObjectCommand({ Bucket, Key: key, ResponseContentDisposition: disposition }),
        { expiresIn: PRESIGN_SECONDS },
      );
    },
    async deletePrefix(prefix) {
      // A page of up to 1000 keys at a time: the most DeleteObjects takes.
      let token: string | undefined;
      do {
        const page = await s3.send(
          new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }),
        );
        const keys = (page.Contents ?? []).flatMap((o) =>
          o.Key === undefined ? [] : [{ Key: o.Key }],
        );
        if (keys.length > 0) {
          checkDeleted(
            await s3.send(
              new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys, Quiet: true } }),
            ),
          );
        }
        token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
      } while (token !== undefined);
    },
    localPath() {
      return null;
    },
    readUrl(key) {
      return getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: key }), {
        expiresIn: READ_URL_SECONDS,
      });
    },
  };
}
