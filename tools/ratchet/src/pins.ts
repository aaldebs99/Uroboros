/**
 * `ratchet pins`: every copy of a toolchain pin must agree.
 *
 * Versions are written down in more than one place because different tools read different files.
 * Nothing but this gate stops them drifting apart, and a drift is invisible until the one
 * environment reading the stale copy (the Docker build, a contributor without mise) breaks.
 *
 * - pnpm: `.mise/config.toml` `[tools].pnpm` = `package.json` `packageManager` =
 *   `package.json` `devEngines.packageManager` (which must also say `"onFail": "error"`, so npm
 *   refuses to run) = `Dockerfile` `ARG PNPM_VERSION`
 * - node: `.mise/config.toml` `[tools].node` = `Dockerfile` `ARG NODE_VERSION`, and it must
 *   satisfy the `>=` lower bound in `package.json` `engines.node`
 * - soak: every `minimumReleaseAge` in `.renovaterc.json5` = `pnpm-workspace.yaml`
 *   `minimumReleaseAge` (minutes), so both bots wait the same time before adopting a release.
 *
 * The Dockerfile checks are skipped, with a note, while no Dockerfile exists. Once it exists, a
 * missing `ARG` is a layout error. A missing file or key elsewhere is also a layout error (exit 2).
 */
import {
  DOCKERFILE,
  MISE,
  PACKAGE_JSON,
  PNPM_WORKSPACE,
  RENOVATE,
  dockerArgs,
  durationMinutes,
  isBefore,
  lowerBound,
  miseTool,
  parsePackageJson,
  parseVersion,
  pnpmFromPackageManager,
  pnpmMinimumReleaseAge,
  renovateAges,
  type DevEngine,
} from "./pinParsers.ts";
import { newReport, pushSection, section, type Report, type Section } from "./report.ts";
import { LayoutError, exists, read, type Repo } from "./repo.ts";

/** The Dockerfile's pins, one value per stage that declares them. */
export type DockerPins = { node: string[]; pnpm: string[] };

/** Every pinned value, as found. */
export type Pins = {
  miseNode: string;
  misePnpm: string;
  enginesNode: string;
  packageManager: string;
  devEngines: DevEngine;
  renovateAges: string[];
  pnpmMinAge: string;
  /** `undefined` while the Dockerfile does not exist yet. */
  docker?: DockerPins;
};

type Entry = [place: string, value: string];

/** A section listing every location when the values disagree; empty when they all agree. */
function agreement(heading: string, entries: Entry[], advice: string): Section {
  const first = entries[0]?.[1];
  const disagree = entries.some(([, value]) => value !== first);
  return section(
    heading,
    disagree ? entries.map(([place, value]) => `${place} = ${value}`) : [],
    advice,
  );
}

function located(place: string, values: string[]): Entry[] {
  return values.map((value) => [place, value]);
}

function nodeSection(pins: Pins): Section {
  const entries: Entry[] = [[`${MISE} [tools].node`, pins.miseNode]];
  entries.push(...located(`${DOCKERFILE} ARG NODE_VERSION`, pins.docker?.node ?? []));
  return agreement(
    "node pin(s) disagree",
    entries,
    `Set ${MISE} [tools].node and every Dockerfile ARG NODE_VERSION to the same version in one commit.`,
  );
}

function enginesProblem(pins: Pins): string | undefined {
  const place = `${PACKAGE_JSON} engines.node = ${pins.enginesNode}`;
  const bound = lowerBound(pins.enginesNode);
  const node = parseVersion(pins.miseNode);
  if (!bound) {
    return `${place} (not a \`>=X.Y.Z\` constraint)`;
  }
  if (!node) {
    return `${MISE} [tools].node = ${pins.miseNode} (not X.Y.Z)`;
  }
  return isBefore(node, bound) ? `${place} but ${MISE} [tools].node = ${pins.miseNode}` : undefined;
}

function enginesSection(pins: Pins): Section {
  const problem = enginesProblem(pins);
  return section(
    "node engine constraint(s) not satisfied by the pinned node",
    problem === undefined ? [] : [problem],
    "Write engines.node as `>=X.Y.Z` with X.Y.Z at or below the mise node pin; when bumping node, raise the lower bound in the same commit.",
  );
}

function pnpmSection(pins: Pins): Section {
  const fromPackage =
    pnpmFromPackageManager(pins.packageManager) ?? `${pins.packageManager} (not pnpm@X.Y.Z)`;
  const { name, version } = pins.devEngines;
  const fromDevEngines = name === "pnpm" ? version : `${name}@${version} (not pnpm)`;
  const entries: Entry[] = [
    [`${MISE} [tools].pnpm`, pins.misePnpm],
    [`${PACKAGE_JSON} packageManager`, fromPackage],
    [`${PACKAGE_JSON} devEngines.packageManager`, fromDevEngines],
  ];
  entries.push(...located(`${DOCKERFILE} ARG PNPM_VERSION`, pins.docker?.pnpm ?? []));
  return agreement(
    "pnpm pin(s) disagree",
    entries,
    `Set ${MISE} [tools].pnpm, ${PACKAGE_JSON} "packageManager": "pnpm@X.Y.Z" and devEngines.packageManager.version, and every Dockerfile ARG PNPM_VERSION to the same version in one commit.`,
  );
}

function npmGuardSection(pins: Pins): Section {
  const onFail = pins.devEngines.onFail;
  return section(
    `npm guard in ${PACKAGE_JSON} is not enforced`,
    onFail === "error"
      ? []
      : [`${PACKAGE_JSON} devEngines.packageManager.onFail = ${JSON.stringify(onFail)}`],
    'Set devEngines.packageManager.onFail to "error" so `npm install` fails instead of writing a package-lock.json next to pnpm-lock.yaml.',
  );
}

function soakItems(pins: Pins): string[] {
  const malformed = pins.renovateAges
    .filter((age) => durationMinutes(age) === undefined)
    .map(
      (age) =>
        `${RENOVATE} minimumReleaseAge = ${JSON.stringify(age)} (not "N days|hours|minutes")`,
    );
  if (malformed.length > 0) {
    return malformed;
  }
  const pnpm = /^\d+$/.test(pins.pnpmMinAge) ? Number(pins.pnpmMinAge) : undefined;
  if (pnpm !== undefined && pins.renovateAges.every((age) => durationMinutes(age) === pnpm)) {
    return [];
  }
  return [
    ...pins.renovateAges.map((age) => `${RENOVATE} minimumReleaseAge = ${JSON.stringify(age)}`),
    `${PNPM_WORKSPACE} minimumReleaseAge = ${pins.pnpmMinAge} (minutes)`,
  ];
}

function soakSection(pins: Pins): Section {
  return section(
    "supply-chain soak setting(s) disagree",
    soakItems(pins),
    `Renovate and pnpm must wait the same time before adopting a release: "3 days" in ${RENOVATE} is 4320 in ${PNPM_WORKSPACE} (minutes). Make every value match.`,
  );
}

/** Decides the outcome. Pure. */
export function evaluatePins(pins: Pins): Report {
  const report = newReport(
    "ratchet pins",
    `node ${pins.miseNode}, pnpm ${pins.misePnpm}, soak ${pins.pnpmMinAge} agree everywhere`,
  );
  if (!pins.docker) {
    report.notes.push(`${DOCKERFILE} not present yet; ${DOCKERFILE} pin checks skipped`);
  }
  for (const part of [
    nodeSection(pins),
    enginesSection(pins),
    pnpmSection(pins),
    npmGuardSection(pins),
    soakSection(pins),
  ]) {
    pushSection(report, part);
  }
  return report;
}

function nonEmpty(values: string[], what: string): string[] {
  if (values.length === 0) {
    throw new LayoutError(`${what} not found`);
  }
  return values;
}

function collectDocker(repo: Repo): DockerPins | undefined {
  if (!exists(repo.root, DOCKERFILE)) {
    return undefined;
  }
  const text = read(repo.root, DOCKERFILE);
  return {
    node: nonEmpty(dockerArgs(text, "NODE_VERSION"), "Dockerfile `ARG NODE_VERSION=...`"),
    pnpm: nonEmpty(dockerArgs(text, "PNPM_VERSION"), "Dockerfile `ARG PNPM_VERSION=...`"),
  };
}

function collectPins(repo: Repo): Pins {
  const mise = read(repo.root, MISE);
  const pkg = parsePackageJson(read(repo.root, PACKAGE_JSON));
  const pins: Pins = {
    miseNode: miseTool(mise, ["node"]),
    misePnpm: miseTool(mise, ["pnpm", "npm:pnpm", "aqua:pnpm/pnpm"]),
    enginesNode: pkg.enginesNode,
    packageManager: pkg.packageManager,
    devEngines: pkg.devEngines,
    renovateAges: renovateAges(read(repo.root, RENOVATE)),
    pnpmMinAge: pnpmMinimumReleaseAge(read(repo.root, PNPM_WORKSPACE)),
  };
  const docker = collectDocker(repo);
  return docker ? { ...pins, docker } : pins;
}

export function runPins(repo: Repo): Report {
  return evaluatePins(collectPins(repo));
}
