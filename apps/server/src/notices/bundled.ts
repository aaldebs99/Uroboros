/**
 * Code other packages compile into their own files, which `pnpm licenses list` cannot see: each
 * host, at the version installed, and what it bundles, with the licence text its package shipped
 * (in `bundled/`). `bundled.test.ts` reads the host's dist and fails when this list drifts from
 * it (after a bump, say); `renderNotices` refuses a host at a version not listed here.
 *
 * Plain data, read by node's type stripping in the image build.
 */

export interface BundledPackage {
  name: string;
  version: string;
  license: string;
  /** Its licence text under `bundled/`; null when the package shipped none. */
  file: string | null;
  author?: string;
}

export interface BundlingHost {
  name: string;
  version: string;
  packages: readonly BundledPackage[];
}

export const BUNDLED: readonly BundlingHost[] = [
  {
    name: "@modelcontextprotocol/server",
    version: "2.4.0",
    packages: [
      { name: "ajv", version: "8.18.0", license: "MIT", file: "ajv@8.18.0.LICENSE" },
      {
        name: "ajv-formats",
        version: "3.0.1",
        license: "MIT",
        file: "ajv-formats@3.0.1.LICENSE",
      },
      {
        name: "@cfworker/json-schema",
        version: "4.1.1",
        license: "MIT",
        file: null,
        author: "Jeremy Danyow",
      },
      {
        name: "content-type",
        version: "1.0.5",
        license: "MIT",
        file: "content-type@1.0.5.LICENSE",
      },
      {
        name: "fast-deep-equal",
        version: "3.1.3",
        license: "MIT",
        file: "fast-deep-equal@3.1.3.LICENSE",
      },
      {
        name: "fast-uri",
        version: "3.1.8",
        license: "BSD-3-Clause",
        file: "fast-uri@3.1.8.LICENSE",
      },
      {
        name: "json-schema-traverse",
        version: "1.0.0",
        license: "MIT",
        file: "json-schema-traverse@1.0.0.LICENSE",
      },
    ],
  },
];
