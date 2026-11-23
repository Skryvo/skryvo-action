import { appendFileSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

/** The workflow's `with:` values, as the runner passes them in INPUT_<NAME>. */
export function inputs(names, env = process.env) {
  return Object.fromEntries(names.map((name) => [name, (env[`INPUT_${name.toUpperCase()}`] || "").trim()]));
}

export function event(env = process.env) {
  return env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")) : {};
}

export function setOutputs(outputs, env = process.env) {
  if (!env.GITHUB_OUTPUT) return;
  for (const [name, value] of Object.entries(outputs)) {
    const fence = `skryvo_${randomUUID()}`;
    appendFileSync(env.GITHUB_OUTPUT, `${name}<<${fence}\n${value}\n${fence}\n`);
  }
}

export function summary(markdown, env = process.env) {
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

/** Keeps a value out of the job's log. */
export const mask = (value) => value && process.stdout.write(`::add-mask::${value}\n`);

export const fail = (message) => {
  process.stdout.write(`::error::${message.replace(/\r?\n/g, "%0A")}\n`);
  process.exitCode = 1;
};
