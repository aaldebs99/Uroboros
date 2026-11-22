import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { logToolVersions } from "./versions.ts";

function fakeLog() {
  const info = vi.fn();
  const warn = vi.fn();
  return { log: { info, warn } as unknown as Logger, info, warn };
}

const dir = mkdtempSync(join(tmpdir(), "uroboros-versions-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("logToolVersions", () => {
  it("warns and does not throw when a tool fails", async () => {
    const { log, info, warn } = fakeLog();
    await expect(
      logToolVersions(log, { ytdlp: "/bin/false", ffmpeg: "/bin/false" }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(info).not.toHaveBeenCalled();
  });

  it("warns and does not throw when a tool is missing", async () => {
    const { log, warn } = fakeLog();
    await logToolVersions(log, { ytdlp: "/nonexistent/yt-dlp", ffmpeg: "/nonexistent/ffmpeg" });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("logs the first line of each tool's version output", async () => {
    const stub = (name: string, body: string) => {
      const path = join(dir, name);
      writeFileSync(path, `#!/bin/sh\n${body}\n`);
      chmodSync(path, 0o755);
      return path;
    };
    const { log, info, warn } = fakeLog();
    await logToolVersions(log, {
      ytdlp: stub("yt-dlp", 'echo "$1"; echo 2026.01.01'),
      ffmpeg: stub("ffmpeg", 'echo "ffmpeg version 7.1 $1"; echo second line'),
    });
    expect(warn).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith({ tool: "yt-dlp", version: "--version" }, "tool version");
    expect(info).toHaveBeenCalledWith(
      { tool: "ffmpeg", version: "ffmpeg version 7.1 -version" },
      "tool version",
    );
  });
});
