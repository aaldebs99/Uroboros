import { describe, expect, it } from "vitest";
import { buildPayload, encodePayload } from "./payload.ts";

describe("buildPayload", () => {
  it("is WebKit's declarative shape", () => {
    expect(
      buildPayload({
        title: "Download finished",
        body: "Big Buck Bunny",
        navigate: "https://uroboros.example/downloads",
        tag: "download:1",
      }),
    ).toEqual({
      web_push: 8030,
      notification: {
        title: "Download finished",
        body: "Big Buck Bunny",
        navigate: "https://uroboros.example/downloads",
        tag: "download:1",
      },
    });
  });

  it("leaves out an empty body and tag", () => {
    expect(
      buildPayload({ title: "Uroboros", body: "  ", navigate: "https://u.example/", tag: "" })
        .notification,
    ).toEqual({ title: "Uroboros", navigate: "https://u.example/" });
    expect(
      Object.keys(buildPayload({ title: "x", navigate: "https://u.example/" }).notification),
    ).toEqual(["title", "navigate"]);
  });

  it("never sends an empty title, which Safari refuses", () => {
    expect(buildPayload({ title: " ", navigate: "https://u.example/" }).notification.title).toBe(
      "Uroboros",
    );
  });

  it("encodes as JSON", () => {
    const payload = buildPayload({ title: "x", navigate: "https://u.example/" });
    expect(JSON.parse(encodePayload(payload))).toEqual(payload);
  });
});
