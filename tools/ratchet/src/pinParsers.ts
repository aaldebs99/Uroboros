/**
 * Pure parsers for the files that repeat a toolchain pin. Each takes the file's text and returns
 * the pin-bearing values, or throws a `LayoutError` that names the file and the missing piece.
 */
import JSON5 from "json5";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";

import { LayoutError } from "./repo.ts";

export const MISE = ".mise/config.toml";
export const PACKAGE_JSON = "package.json";
export const PNPM_WORKSPACE = "pnpm-workspace.yaml";
export const RENOVATE = ".renovaterc.json5";
export const DOCKERFILE = "Dockerfile";

/** `devEngines.packageManager` from package.json. */
export type DevEngine = { name: string; version: string; onFail?: string };

export type PackageJson = { packageManager: string; enginesNode: string; devEngines: DevEngine };

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * `[tools].<name>` from a mise config: either `name = "1.2.3"` or `name = { version = "1.2.3" }`.
 * The first of `names` present wins (pnpm may be spelled `pnpm` or `npm:pnpm`).
 */
export function miseTool(text: string, names: string[]): string {
  let doc: Record<string, unknown>;
  try {
    doc = parseToml(text);
  } catch (error) {
    throw new LayoutError(`cannot parse ${MISE}: ${describe(error)}`);
  }
  const tools = asRecord(doc["tools"]);
  if (!tools) {
    throw new LayoutError(`${MISE} has no [tools] table`);
  }
  const name = names.find((candidate) => candidate in tools);
  if (name === undefined) {
    throw new LayoutError(`${MISE} [tools] does not pin any of: ${names.join(", ")}`);
  }
  const value = tools[name];
  const version = typeof value === "string" ? value : asRecord(value)?.["version"];
  if (typeof version !== "string") {
    throw new LayoutError(
      `${MISE} [tools].${name} must be a version string or a table with \`version = "..."\``,
    );
  }
  return version;
}

function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted?.[2] ?? value;
}

/** Every default value of `ARG <name>=<value>` in a Dockerfile (one per stage that declares it). */
export function dockerArgs(text: string, name: string): string[] {
  return text.split("\n").flatMap((line) => {
    const match = /^\s*ARG\s+([^=\s]+)\s*=\s*(.+?)\s*$/i.exec(line);
    return match?.[1] === name && match[2] !== undefined ? [unquote(match[2])] : [];
  });
}

/** Top-level `minimumReleaseAge` of pnpm-workspace.yaml, in minutes, as written. */
export function pnpmMinimumReleaseAge(text: string): string {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (error) {
    throw new LayoutError(`cannot parse ${PNPM_WORKSPACE}: ${describe(error)}`);
  }
  const age = asRecord(doc)?.["minimumReleaseAge"];
  if (typeof age !== "number" && typeof age !== "string") {
    throw new LayoutError(`${PNPM_WORKSPACE} has no top-level \`minimumReleaseAge:\``);
  }
  return String(age);
}

function collectAges(node: unknown, found: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((item) => {
      collectAges(item, found);
    });
    return;
  }
  const record = asRecord(node);
  if (!record) {
    return;
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === "minimumReleaseAge") {
      // An explicit `null` is a rule opting out of the soak (the ffmpeg mirror's, which the
      // docker datasource cannot time); it is a different statement from a wrong duration.
      if (value === null) {
        continue;
      }
      found.push(typeof value === "string" ? value : JSON.stringify(value));
    } else {
      collectAges(value, found);
    }
  }
}

/** Every `minimumReleaseAge` value anywhere in the Renovate config. */
export function renovateAges(text: string): string[] {
  let doc: unknown;
  try {
    doc = JSON5.parse(text);
  } catch (error) {
    throw new LayoutError(`cannot parse ${RENOVATE}: ${describe(error)}`);
  }
  const found: string[] = [];
  collectAges(doc, found);
  if (found.length === 0) {
    throw new LayoutError(`${RENOVATE} has no \`minimumReleaseAge\``);
  }
  return found;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function devEngine(doc: Record<string, unknown>): DevEngine {
  const block = asRecord(asRecord(doc["devEngines"])?.["packageManager"]);
  if (!block) {
    throw new LayoutError(
      `${PACKAGE_JSON} has no "devEngines": { "packageManager": { ... } } object`,
    );
  }
  const name = stringField(block, "name");
  const version = stringField(block, "version");
  if (name === undefined || version === undefined) {
    throw new LayoutError(
      `${PACKAGE_JSON} devEngines.packageManager needs string "name" and "version"`,
    );
  }
  const onFail = stringField(block, "onFail");
  return onFail === undefined ? { name, version } : { name, version, onFail };
}

/** `packageManager`, `engines.node` and `devEngines.packageManager` from package.json. */
export function parsePackageJson(text: string): PackageJson {
  let doc: Record<string, unknown> | undefined;
  try {
    doc = asRecord(JSON.parse(text));
  } catch (error) {
    throw new LayoutError(`cannot parse ${PACKAGE_JSON}: ${describe(error)}`);
  }
  const packageManager = doc ? stringField(doc, "packageManager") : undefined;
  const enginesNode = asRecord(doc?.["engines"])?.["node"];
  if (!doc || packageManager === undefined) {
    throw new LayoutError(`${PACKAGE_JSON} has no "packageManager" string`);
  }
  if (typeof enginesNode !== "string") {
    throw new LayoutError(`${PACKAGE_JSON} has no "engines": { "node": ... }`);
  }
  return { packageManager, enginesNode, devEngines: devEngine(doc) };
}

/** `pnpm@12.12.1+sha512.…` gives `12.12.1`. `undefined` if it does not name pnpm. */
export function pnpmFromPackageManager(value: string): string | undefined {
  return value.startsWith("pnpm@") ? value.slice("pnpm@".length).split("+")[0] : undefined;
}

/** `1.2.3` gives `[1, 2, 3]`. A leading `v` is tolerated; anything non-numeric is `undefined`. */
export function parseVersion(value: string): number[] | undefined {
  const parts = value.trim().replace(/^v/, "").split(".");
  const numbers = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  return numbers.some(Number.isNaN) ? undefined : numbers;
}

/** The version in a `>=X.Y.Z` constraint. Other constraint shapes are `undefined`. */
export function lowerBound(constraint: string): number[] | undefined {
  const trimmed = constraint.trim();
  return trimmed.startsWith(">=") ? parseVersion(trimmed.slice(2)) : undefined;
}

/** Whether version `a` sorts before `b`, comparing numerically part by part. */
export function isBefore(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) {
      return diff < 0;
    }
  }
  return false;
}

const UNIT_MINUTES: Record<string, number> = {
  day: 24 * 60,
  days: 24 * 60,
  hour: 60,
  hours: 60,
  minute: 1,
  minutes: 1,
};

/** A Renovate duration (`"3 days"`, `"12 hours"`, `"30 minutes"`) in minutes. */
export function durationMinutes(value: string): number | undefined {
  const match = /^(\d+) +([a-z]+)$/.exec(value.trim());
  const per = match?.[2] === undefined ? undefined : UNIT_MINUTES[match[2]];
  return match?.[1] === undefined || per === undefined ? undefined : Number(match[1]) * per;
}
