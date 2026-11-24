import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type DeleteObjectsCommandOutput,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageConfig } from "./config.ts";
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
  return {
    async put(key, file, contentType) {
      await new Upload({
        client: s3,
        params: { Bucket, Key: key, Body: createReadStream(file), ContentType: contentType },
      }).done();
      return { size: (await stat(file)).size };
    },
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
      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: head.ContentLength ?? 0 };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
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
