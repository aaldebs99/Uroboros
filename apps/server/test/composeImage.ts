import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "../src/shared/repoRoot.ts";

/**
 * The `image:` of a service in compose.yaml. compose.yaml is the one place the third-party images
 * are pinned (exact tag and digest, kept current by Renovate's docker-compose manager); the test
 * setup, CI and the image smoke test all read them from there
 * (scripts/image/compose-image.sh is the shell side).
 */
export function composeImage(service: string): string {
  const lines = readFileSync(join(findRepoRoot(), "compose.yaml"), "utf8").split("\n");
  const start = lines.indexOf(`  ${service}:`);
  if (start !== -1) {
    for (const line of lines.slice(start + 1)) {
      if (/^ {2}\S/.test(line)) break; // the next service
      const image = /^ {4}image:\s*(\S+)\s*$/.exec(line)?.[1];
      if (image !== undefined) return image;
    }
  }
  throw new Error(`compose.yaml has no image for a service named ${service}`);
}
