import { describe, expect, it } from "vitest";

import { noticeOf, targetOf } from "./notice";

const ORIGIN = "https://uroboros.example";

describe("noticeOf", () => {
  it("reads the declarative payload", () => {
    expect(
      noticeOf(
        {
          web_push: 8030,
          notification: {
            title: "Download finished",
            body: "Big Buck Bunny",
            navigate: `${ORIGIN}/downloads`,
            tag: "download:1",
          },
        },
        ORIGIN,
      ),
    ).toEqual({
      title: "Download finished",
      body: "Big Buck Bunny",
      navigate: `${ORIGIN}/downloads`,
      tag: "download:1",
    });
  });

  it("shows something for anything else", () => {
    for (const data of [
      null,
      "text",
      3,
      {},
      { notification: "x" },
      { notification: { title: " ", tag: "" } },
    ]) {
      expect(noticeOf(data, ORIGIN)).toEqual({
        title: "Uroboros",
        body: "",
        navigate: `${ORIGIN}/`,
      });
    }
  });
});

describe("targetOf", () => {
  it("keeps a tap within the app", () => {
    expect(targetOf(`${ORIGIN}/downloads?id=1#x`, ORIGIN)).toBe("/downloads?id=1#x");
    expect(targetOf("/settings", ORIGIN)).toBe("/settings");
    expect(targetOf("https://evil.example/", ORIGIN)).toBe("/");
    expect(targetOf("//evil.example/x", ORIGIN)).toBe("/");
    expect(targetOf("javascript:alert(1)", ORIGIN)).toBe("/");
    expect(targetOf("::not a url", "not an origin")).toBe("/");
  });
});
