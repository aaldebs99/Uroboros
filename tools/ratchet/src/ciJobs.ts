/**
 * The job-level half of `ci-parity`: a gate only gates when its failure fails the required check.
 *
 * Branch protection requires one status, the `ci` job. A job that runs a `mise run` step but is
 * missing from the `ci` job's `needs` can fail without failing that status, and a
 * `continue-on-error` anywhere lets a step or job fail while reporting success. Either one makes a
 * red gate merge green, so both are violations.
 */
import { parse as parseYaml } from "yaml";

import { section, type Section } from "./report.ts";
import { LayoutError } from "./repo.ts";

export const CI_JOB = "ci";
const GATE_RUN = /^mise run [a-z0-9:_-]+$/;

export type Jobs = {
  /** Jobs holding at least one gate step. */
  gated: Set<string>;
  /** The `needs` of the `ci` job. */
  needs: Set<string>;
  /** Every `continue-on-error` key outside a comment, as `line N: <text>`. */
  continueOnError: string[];
};

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hasGateStep(job: unknown): boolean {
  const steps = record(job)?.["steps"];
  if (!Array.isArray(steps)) return false;
  return steps.some((step) => {
    const run = record(step)?.["run"];
    return typeof run === "string" && GATE_RUN.test(run.trim());
  });
}

function needsOf(job: unknown, workflow: string): Set<string> {
  const needs = record(job)?.["needs"];
  if (typeof needs === "string") return new Set([needs]);
  if (Array.isArray(needs) && needs.every((n) => typeof n === "string")) return new Set(needs);
  throw new LayoutError(
    `${workflow} has no \`${CI_JOB}\` job with \`needs:\`; refusing to check the jobs against it`,
  );
}

function parseWorkflow(text: string, workflow: string): Record<string, unknown> {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (error) {
    throw new LayoutError(
      `cannot parse ${workflow}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const jobs = record(record(doc)?.["jobs"]);
  if (jobs === undefined) throw new LayoutError(`${workflow} has no \`jobs:\` mapping`);
  return jobs;
}

/** Reads the gated jobs, the `ci` job's needs and every `continue-on-error` from a workflow. */
export function readJobs(text: string, workflow: string): Jobs {
  const jobs = parseWorkflow(text, workflow);
  const gated = new Set(Object.keys(jobs).filter((name) => hasGateStep(jobs[name])));
  const needs = needsOf(jobs[CI_JOB], workflow);
  const continueOnError = text
    .split("\n")
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => !line.trimStart().startsWith("#") && line.includes("continue-on-error"))
    .map(({ line, index }) => `line ${String(index + 1)}: ${line.trim()}`);
  return { gated, needs, continueOnError };
}

/** The failure sections for a set of jobs. Pure. */
export function jobSections(jobs: Jobs, workflow: string): Section[] {
  return [
    section(
      `job(s) with a \`mise run\` step that the \`${CI_JOB}\` job does not need`,
      [...jobs.gated].filter((name) => !jobs.needs.has(name)).sort(),
      `Add each job to \`needs:\` of the \`${CI_JOB}\` job in ${workflow} and check its result there; the \`${CI_JOB}\` job is the required status check, so a job outside it can fail without blocking a merge.`,
    ),
    section(
      `\`continue-on-error\` in ${workflow}`,
      jobs.continueOnError,
      "Remove it. A gate that may fail is not a gate; fix the failure or take the task out of the gate list.",
    ),
  ];
}
