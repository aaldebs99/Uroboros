import { randomUUID } from "node:crypto";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { inject } from "vitest";
import type { StorageConfig } from "../src/storage/config.ts";
import { TEST_S3_KEY, TEST_S3_SECRET } from "./s3Credentials.ts";

type S3Config = Extract<StorageConfig, { kind: "s3" }>;

export const TestS3 = {
  /** A fresh, empty bucket on the shared test RustFS, so tests never see each other's objects. */
  async bucket(over: Partial<S3Config> = {}): Promise<S3Config> {
    const config: S3Config = {
      kind: "s3",
      endpoint: inject("s3Url"),
      region: "us-east-1",
      bucket: `t-${randomUUID()}`,
      accessKeyId: TEST_S3_KEY,
      secretAccessKey: TEST_S3_SECRET,
      forcePathStyle: true,
      publicUrl: null,
      ...over,
    };
    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
    try {
      await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
    } finally {
      client.destroy();
    }
    return config;
  },
};
