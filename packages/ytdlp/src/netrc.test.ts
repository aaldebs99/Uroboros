import { readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { YtDlpError } from "./errors.ts";
import { netrcText, withNetrc } from "./netrc.ts";

describe("netrcText", () => {
  it("writes one quoted line per login, escaping backslashes and quotes", () => {
    expect(
      netrcText([
        { site: "vimeo", username: "me@example.com", password: 'p a"s\\s#w' },
        { site: "twitch", username: "#x", password: "ends\\" },
      ]),
    ).toBe(
      'machine vimeo login "me@example.com" password "p a\\"s\\\\s#w"\n' +
        'machine twitch login "#x" password "ends\\\\"\n',
    );
  });

  it("refuses control characters, empty values and odd machine names", () => {
    for (const login of [
      { site: "vimeo", username: "me", password: "line\nbreak" },
      { site: "vimeo", username: "", password: "x" },
      { site: "-vimeo", username: "me", password: "x" },
      { site: "vi meo", username: "me", password: "x" },
    ]) {
      expect(() => netrcText([login])).toThrow(YtDlpError);
    }
  });
});

describe("withNetrc", () => {
  it("passes null and writes nothing without logins", async () => {
    expect(await withNetrc([], (dir) => Promise.resolve(dir))).toBeNull();
  });

  it("writes a private .netrc for the call and removes it afterwards", async () => {
    const before = await readdir(tmpdir());
    const seen = await withNetrc(
      [{ site: "vimeo", username: "me", password: "hunter22" }],
      async (dir) => {
        if (dir === null) throw new Error("expected a directory");
        const file = join(dir, ".netrc");
        return { text: await readFile(file, "utf8"), mode: (await stat(file)).mode & 0o777 };
      },
    );
    expect(seen).toEqual({ text: 'machine vimeo login "me" password "hunter22"\n', mode: 0o600 });
    const leftovers = (await readdir(tmpdir())).filter(
      (name) => name.startsWith("uroboros-netrc-") && !before.includes(name),
    );
    expect(leftovers).toEqual([]);
  });
});
