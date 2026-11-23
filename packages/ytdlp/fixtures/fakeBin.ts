#!/usr/bin/env node
/**
 * A stand-in for yt-dlp and ffprobe in tests: it replays the scenario named by
 * FAKE_BIN_SCENARIO (a JSON file) and records its argv to FAKE_BIN_ARGV. Run by node's type
 * stripping, so it imports nothing but node builtins.
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export type Step =
  | { stdout: string }
  | { stderr: string }
  | { sleepMs: number }
  | { writeFile: string; content: string }
  | { spawnSleeper: string }
  | { hang: true };

export interface Scenario {
  steps: Step[];
  exitCode?: number;
  /**
   * Alternatives chosen by argument: the first whose `whenArg` is one of the fake's arguments
   * (a URL, say) replaces `steps` and `exitCode`, so one scenario can answer several calls.
   */
  variants?: { whenArg: string; steps: Step[]; exitCode?: number }[];
  ignoreSigterm?: boolean;
  /** The fake writes its own pid here (relative to its working directory) as it starts. */
  pidFile?: string;
}

function fill(text: string): string {
  return text.replaceAll("{{cwd}}", process.cwd());
}

function write(stream: NodeJS.WriteStream, text: string): Promise<void> {
  return new Promise((done) => {
    stream.write(fill(text), () => {
      done();
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

async function run(step: Step): Promise<void> {
  if ("stdout" in step) return write(process.stdout, step.stdout);
  if ("stderr" in step) return write(process.stderr, step.stderr);
  if ("sleepMs" in step) return sleep(step.sleepMs);
  if ("writeFile" in step) {
    writeFileSync(resolve(step.writeFile), fill(step.content));
    return;
  }
  if ("spawnSleeper" in step) {
    // Stays in this process's group, as ffmpeg does under yt-dlp.
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    writeFileSync(resolve(step.spawnSleeper), String(child.pid));
    return;
  }
  setInterval(() => undefined, 1000);
  await new Promise(() => undefined);
}

async function main(): Promise<void> {
  const argvFile = process.env["FAKE_BIN_ARGV"];
  if (argvFile !== undefined) writeFileSync(argvFile, JSON.stringify(process.argv.slice(2)));
  const scenarioFile = process.env["FAKE_BIN_SCENARIO"];
  if (scenarioFile === undefined) throw new Error("FAKE_BIN_SCENARIO is not set");
  const scenario = JSON.parse(readFileSync(scenarioFile, "utf8")) as Scenario;
  if (scenario.pidFile !== undefined) writeFileSync(resolve(scenario.pidFile), String(process.pid));
  if (scenario.ignoreSigterm === true) process.on("SIGTERM", () => undefined);
  const args = process.argv.slice(2);
  const chosen = scenario.variants?.find((v) => args.includes(v.whenArg)) ?? scenario;
  for (const step of chosen.steps) await run(step);
  process.exitCode = chosen.exitCode ?? 0;
}

await main();
