import { describe, expect, it } from "vitest";

import { ApiError } from "@/api/client";

import { sendParts } from "./sendParts";

const file = new Blob(["abcdefghij"]);
const upload = { id: "u1", size: 10, partSize: 4, receivedParts: [] as number[] };
const noWait = () => Promise.resolve();

const text = (blob: Blob): Promise<string> => blob.text();

describe("sendParts", () => {
  it("sends the missing parts in order, each its slice, reporting the bytes as they go", async () => {
    const sent: [number, string][] = [];
    const progress: number[] = [];
    await sendParts({
      upload: { ...upload, receivedParts: [2] },
      file,
      put: async (n, part, onProgress) => {
        sent.push([n, await text(part)]);
        onProgress(part.size);
      },
      onProgress: (bytes) => progress.push(bytes),
      signal: new AbortController().signal,
      wait: noWait,
    });
    expect(sent).toEqual([
      [1, "abcd"],
      [3, "ij"],
    ]);
    expect(progress.at(0)).toBe(4);
    expect(progress.at(-1)).toBe(10);
  });

  it("tries a part again after a network failure, three times at most", async () => {
    let calls = 0;
    await sendParts({
      upload: { ...upload, size: 4, partSize: 4 },
      file: new Blob(["abcd"]),
      put: () => {
        calls++;
        return calls < 3 ? Promise.reject(new TypeError("offline")) : Promise.resolve();
      },
      onProgress: () => undefined,
      signal: new AbortController().signal,
      wait: noWait,
    });
    expect(calls).toBe(3);
    calls = 0;
    await expect(
      sendParts({
        upload: { ...upload, size: 4, partSize: 4 },
        file: new Blob(["abcd"]),
        put: () => {
          calls++;
          return Promise.reject(new TypeError("offline"));
        },
        onProgress: () => undefined,
        signal: new AbortController().signal,
        wait: noWait,
      }),
    ).rejects.toThrow("offline");
    expect(calls).toBe(4);
  });

  it("gives up at once on a part the server refuses", async () => {
    let calls = 0;
    const refused = new ApiError(409, "conflict", { code: "conflict", message: "complete" });
    await expect(
      sendParts({
        upload,
        file,
        put: () => {
          calls++;
          return Promise.reject(refused);
        },
        onProgress: () => undefined,
        signal: new AbortController().signal,
        wait: noWait,
      }),
    ).rejects.toBe(refused);
    expect(calls).toBe(1);
  });

  it("stops when it is cancelled", async () => {
    const stop = new AbortController();
    const sent: number[] = [];
    await expect(
      sendParts({
        upload,
        file,
        put: (n) => {
          sent.push(n);
          stop.abort();
          return Promise.resolve();
        },
        onProgress: () => undefined,
        signal: stop.signal,
        wait: noWait,
      }),
    ).rejects.toThrow();
    expect(sent).toEqual([1]);
  });
});
