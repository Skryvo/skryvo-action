import { run } from "./run.js";
import { client } from "./skryvo.js";
import { event, fail, inputs, mask, setOutputs, summary } from "./runner.js";

const NAMES = [
  "api-key",
  "brand-id",
  "article",
  "platforms",
  "pictures",
  "topic",
  "notes",
  "source-url",
  "wait",
  "timeout-minutes",
  "poll-seconds",
];

function report(out) {
  const posts = JSON.parse(out.posts);
  const lines = ["## Skryvo", ""];
  if (out["article-url"]) lines.push(`Article: [${out["article-title"]}](${out["article-url"]})`, "");
  else if (out["article-id"]) lines.push(`Article ${out["article-id"]}: ${out["article-status"]}`, "");
  for (const p of posts) {
    lines.push(`**${p.platform}**${p.open_in_skryvo ? ` ([open in Skryvo](${p.open_in_skryvo}))` : ""}`, "");
    lines.push(p.text ? `> ${p.text.replace(/\n/g, "\n> ")}` : `Not written: ${p.error}`, "");
  }
  lines.push("Nothing is published or scheduled until you approve it in Skryvo.");
  return lines.join("\n");
}

const given = inputs(NAMES);
mask(given["api-key"]);
try {
  if (!given["api-key"]) throw new Error("Set api-key, for example `api-key: ${{ secrets.SKRYVO_API_KEY }}`.");
  const out = await run({
    inputs: given,
    event: event(),
    repository: process.env.GITHUB_REPOSITORY,
    call: client({ apiKey: given["api-key"] }),
    log: (line) => process.stdout.write(`${line}\n`),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  setOutputs(out);
  summary(report(out));
} catch (error) {
  fail(error.message);
}
