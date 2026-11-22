import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The third-party notices the images carry for the bundled JavaScript: every production
 * dependency of the server bundle and the web app, with the licence and notice files its package
 * ships. The input is `pnpm licenses list --json --prod`; the Dockerfile writes the result to
 * `/usr/share/licenses/uroboros/THIRD_PARTY_NOTICES.txt`.
 *
 * Plain node (type stripping, no dependencies), so the image build can run it before bundling.
 */

export interface LicensedPackage {
  name: string;
  versions: string[];
  paths: string[];
  license: string;
  homepage?: string;
  author?: string;
}

/** `pnpm licenses list --json`: packages grouped by licence. */
export type LicensesReport = Record<string, LicensedPackage[]>;

const LICENCE_FILE = /^(licen[cs]e|copying|notice)([.-][\w.-]*)?$/i;
const CODE_FILE = /\.(c|m)?(j|t)sx?$/i;

function licenceFiles(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => LICENCE_FILE.test(n) && !CODE_FILE.test(n)).sort();
}

function renderPackage(pkg: LicensedPackage): string {
  const header = [
    "=".repeat(78),
    `${pkg.name}@${pkg.versions.join(", ")}`,
    `Licence: ${pkg.license}`,
    ...(pkg.homepage === undefined ? [] : [`Home: ${pkg.homepage}`]),
    "=".repeat(78),
  ];
  const dir = pkg.paths[0];
  const files = dir === undefined ? [] : licenceFiles(dir);
  const bodies =
    dir === undefined || files.length === 0
      ? [`No licence file in the package; its package.json declares ${pkg.license}.`]
      : files.map((f) => `--- ${f}\n\n${readFileSync(join(dir, f), "utf8").trimEnd()}`);
  return [...header, "", ...bodies, ""].join("\n");
}

/** The notices text for a licences report, packages sorted by name. */
export function renderNotices(report: LicensesReport): string {
  const packages = Object.values(report)
    .flat()
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (packages.length === 0) throw new Error("the licences report lists no packages");
  const intro = [
    "Third-party software bundled into Uroboros (the server bundle and the web app).",
    "Each entry is a production npm dependency, with the licence and notice files its package ships.",
    "",
  ].join("\n");
  return [intro, ...packages.map(renderPackage)].join("\n");
}

/** `notices <report.json> <out.txt>`. Exit codes: 0 written, 2 usage. */
export function main(argv: string[]): number {
  const [input, output] = argv;
  if (input === undefined || output === undefined) {
    console.error("usage: notices <pnpm-licenses.json> <out.txt>");
    return 2;
  }
  const report = JSON.parse(readFileSync(input, "utf8")) as LicensesReport;
  writeFileSync(output, renderNotices(report));
  return 0;
}
