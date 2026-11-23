import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { TestS3 } from "./testS3.ts";

describe("TestS3", () => {
  it("creates a fresh bucket on the test RustFS", async () => {
    const config = await TestS3.bucket();
    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
    try {
      await expect(
        client.send(new HeadBucketCommand({ Bucket: config.bucket })),
      ).resolves.toBeDefined();
    } finally {
      client.destroy();
    }
  });
});
