import { describe, expect, it } from "vitest";
import { checkUrl, commandLine } from "./args.ts";
import { classifyFailure, failureMessage, YtDlpError, type YtDlpErrorKind } from "./errors.ts";
import { LineSplitter, LineTail } from "./lines.ts";
import { redactLine } from "./redact.ts";

describe("LineSplitter", () => {
  it("holds a partial line until the rest of it arrives", () => {
    const lines = new LineSplitter();
    expect(lines.push("one\ntw")).toEqual(["one"]);
    expect(lines.push("o\nthr")).toEqual(["two"]);
    expect(lines.push("ee")).toEqual([]);
    expect(lines.flush()).toEqual(["three"]);
    expect(lines.flush()).toEqual([]);
  });

  it("ends lines at \\r, \\n and \\r\\n, even split across chunks, and drops empty ones", () => {
    const lines = new LineSplitter();
    expect(lines.push("a\rb\r")).toEqual(["a", "b"]);
    expect(lines.push("\nc\r\n\n")).toEqual(["c"]);
  });
});

describe("LineTail", () => {
  it("keeps only the last lines", () => {
    const tail = new LineTail(2);
    ["a", "b", "c"].forEach((line) => {
      tail.push(line);
    });
    expect(tail.get()).toEqual(["b", "c"]);
  });
});

describe("redactLine", () => {
  it("drops query strings and userinfo from URLs", () => {
    expect(
      redactLine(
        "ERROR: unable to fetch https://rr3.googlevideo.com/videoplayback?expire=1&ip=203.0.113.7&sig=abc failed with 403",
      ),
    ).toBe(
      "ERROR: unable to fetch https://rr3.googlevideo.com/videoplayback?<redacted> failed with 403",
    );
    expect(redactLine("proxy http://user:pass@proxy.example:8080/ failed")).toBe(
      "proxy http://<redacted>@proxy.example:8080/ failed",
    );
    expect(redactLine("see https://example.com/watch")).toBe("see https://example.com/watch");
  });

  it("redacts cookie and authorization headers, bearer tokens and cookie-file lines", () => {
    expect(redactLine("[debug] Cookie: SID=abc; HSID=def")).toBe("[debug] Cookie: <redacted>");
    expect(redactLine(`{"Authorization": "Basic dXNlcjpwYXNz"}`)).toBe(
      `{"Authorization": <redacted>`,
    );
    expect(redactLine("token Bearer eyJhbGciOi.payload.sig here")).toBe(
      "token Bearer <redacted> here",
    );
    expect(redactLine(".youtube.com\tTRUE\t/\tTRUE\t1795389424\tSID\tsecret")).toBe("<redacted>");
  });

  it("drops a netrc line, and blanks the run's own passwords wherever they appear", () => {
    expect(redactLine('machine vimeo login "me" password "hunter22"')).toBe("<redacted>");
    expect(redactLine("[debug] posting hunter22 to the login form", ["hunter22"])).toBe(
      "[debug] posting <redacted> to the login form",
    );
    // A very short password would blank ordinary words, so it is left to the other rules.
    expect(redactLine("ERROR: abc failed", ["abc"])).toBe("ERROR: abc failed");
    expect(redactLine("Please login with password", [])).toBe("Please login with password");
  });
});

describe("classifyFailure", () => {
  const cases: [string, YtDlpErrorKind][] = [
    ["ERROR: [youtube] xxxxxxxxxxx: This video is unavailable", "unavailable"],
    ["ERROR: [youtube] abc: Video unavailable. This video is private", "private"],
    ["ERROR: [youtube] abc: Join this channel to get access to members-only content", "private"],
    [
      "ERROR: [youtube] abc: The uploader has not made this video available in your country",
      "geo_blocked",
    ],
    [
      "ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.",
      "age_restricted",
    ],
    ["ERROR: [youtube] abc: HTTP Error 429: Too Many Requests", "rate_limited"],
    ["ERROR: [youtube] abc: Sign in to confirm you’re not a bot", "rate_limited"],
    [
      "ERROR: [generic] x: Unable to download webpage: <urlopen error [Errno -3] Temporary failure in name resolution>",
      "network",
    ],
    [
      "ERROR: [youtube] abc: Unable to download API page: HTTP Error 503: Service Unavailable",
      "network",
    ],
    // yt-dlp's raise_login_required: Vimeo's page needs an account since 2025.
    [
      "ERROR: [vimeo] 753580183: The web client only works when logged-in. Use --cookies, --cookies-from-browser, --username and --password, --netrc-cmd, or --netrc (vimeo) to provide account credentials. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies",
      "login_required",
    ],
    [
      "ERROR: [patreon] 123: This video is only available for registered users. Use --cookies-from-browser or --cookies for the authentication.",
      "login_required",
    ],
    ["ERROR: [twitter] 456: Login is required to access this content", "login_required"],
    // A saved login the site refused, as the extractors word it.
    ["ERROR: [vimeo] Unable to log in: bad username or password", "login_failed"],
    [
      "ERROR: [twitch:vod] Unable to login. Twitch said: Invalid username or password",
      "login_failed",
    ],
    ["ERROR: [soundcloud] Unable to login: Wrong password", "login_failed"],
    [
      "ERROR: [niconico] Unable to log in: Invalid username/password; Use --cookies-from-browser or --cookies for the authentication.",
      "login_failed",
    ],
    ["ERROR: [vk] Login failed", "login_failed"],
    ["ERROR: [udemy] Unable to login: incorrect username and/or password", "login_failed"],
    ["ERROR: Unsupported URL: https://example.com/", "unsupported_url"],
    ["ERROR: [generic] x: Unable to download webpage: HTTP Error 404: Not Found", "unavailable"],
    ["ERROR: something nobody has seen before", "unknown"],
  ];

  it.each(cases)("classifies %j as %s", (line, kind) => {
    expect(classifyFailure(1, ["[youtube] Extracting URL", line])).toBe(kind);
  });

  it("prefers the ERROR lines over earlier warnings", () => {
    const stderr = [
      "WARNING: [youtube] HTTP Error 429 while fetching the player, retrying",
      "ERROR: [youtube] abc: This video has been removed by the uploader",
    ];
    expect(classifyFailure(1, stderr)).toBe("unavailable");
  });

  it("falls back to the whole tail when there is no ERROR line", () => {
    expect(classifyFailure(1, ["urlopen error [Errno 111] Connection refused"])).toBe("network");
  });

  it("reads exit code 2 with a usage error as invalid arguments", () => {
    const stderr = ["Usage: yt-dlp [OPTIONS] URL", "yt-dlp: error: no such option: --bogus"];
    expect(classifyFailure(2, stderr)).toBe("invalid_arguments");
  });

  it("takes the message from the last ERROR line", () => {
    expect(failureMessage(1, ["ERROR: first", "ERROR: [youtube] x: last"])).toBe(
      "[youtube] x: last",
    );
    expect(failureMessage(null, [])).toBe("exited with a signal");
    expect(failureMessage(3, [])).toBe("exited with code 3");
  });
});

function kindOf(fn: () => unknown): YtDlpErrorKind | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof YtDlpError ? error.kind : null;
  }
}

describe("arguments", () => {
  it("accepts http and https URLs only", () => {
    expect(checkUrl("https://www.youtube.com/watch?v=aqz-KE-bpKQ")).toBe(
      "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    );
    expect(checkUrl("http://example.com")).toBe("http://example.com/");
    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com/x",
      "--exec=id",
      "",
      "ytsearch:x",
    ]) {
      expect(kindOf(() => checkUrl(url))).toBe("invalid_url");
    }
  });

  it("puts the URL last, behind --", () => {
    const files = { cookies: "/tmp/c.txt", netrcDir: "/tmp/n" };
    expect(commandLine(files, ["--a"], ["--b"], "https://x.example/")).toEqual([
      "--ignore-config",
      "--no-update",
      "--color",
      "never",
      "--cookies",
      "/tmp/c.txt",
      "--netrc",
      "--netrc-location",
      "/tmp/n",
      "--a",
      "--b",
      "--",
      "https://x.example/",
    ]);
  });
});
