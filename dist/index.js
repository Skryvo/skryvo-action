// src/run.js
var APP = "https://app.skryvo.ai";
var TOPIC_CHARS = 200;
var NOTES_CHARS = 2e3;
var MOST_DRAFT_PLATFORMS = 4;
var clip = (text, most) => text.length <= most ? text : `${text.slice(0, most - 1).trimEnd()}\u2026`;
var list = (value) => [...new Set((value || "").split(/[\s,]+/).map((p) => p.trim().toLowerCase()).filter(Boolean))];
function release(inputs2, event2, repository) {
  const r = event2?.release;
  const repo = (repository || "").split("/").pop();
  const notes = (inputs2.notes || r?.body || "").trim();
  const url = (inputs2["source-url"] || r?.html_url || "").trim();
  const named = r ? [repo, r.tag_name, r.name && r.name !== r.tag_name ? r.name : ""].filter(Boolean).join(" ") : "";
  const topic = (inputs2.topic || named && `What's new in ${named}` || "").trim();
  if (!topic) {
    throw new Error("Nothing to write about: run this on a release, or pass topic (and notes or source-url).");
  }
  if (!notes && !url) throw new Error("Pass the release notes in notes, or a page to read in source-url.");
  return { topic: clip(topic, TOPIC_CHARS), notes: clip(notes, NOTES_CHARS), url };
}
async function article(call, log, about, inputs2, sleep) {
  const plan = await call("POST", "/articles/plan", {
    topic: about.topic,
    ...inputs2["brand-id"] ? { brand_id: inputs2["brand-id"] } : {},
    ...about.notes ? { only_you: about.notes } : {},
    ...about.url ? { sources: [about.url] } : {}
  });
  log(`Planned "${plan.headline}" (${plan.outline?.length ?? 0} sections).`);
  let status = await call("POST", "/articles", { plan_id: plan.plan_id });
  log(`Writing the article; Skryvo says about ${status.minutes ?? 4} minutes.`);
  if (inputs2.wait === "false") return { plan, status };
  const interval = Number(inputs2["poll-seconds"] || 30) * 1e3;
  const deadline = Date.now() + Number(inputs2["timeout-minutes"] || 25) * 6e4;
  while (status.status === "writing") {
    if (Date.now() + interval > deadline) {
      throw new Error(`The article is still being written. Follow it in Skryvo; its id is ${plan.plan_id}.`);
    }
    await sleep(interval);
    status = await call("GET", `/articles/${encodeURIComponent(plan.plan_id)}`);
    if (status.status === "writing") log(`Still writing: ${status.stage ?? "starting"}.`);
  }
  if (status.status === "failed") throw new Error(`The article was not written: ${status.error} It was not charged.`);
  log(`Article ready: "${status.title}", ${status.words} words, score ${status.score ?? "not scored"}.`);
  return { plan, status };
}
async function posts(call, log, about, inputs2, written) {
  const platforms = list(inputs2.platforms);
  if (!platforms.length) return null;
  if (written?.status === "done") {
    const made2 = await call("POST", `/articles/${encodeURIComponent(written.article_id)}/posts`, { platforms });
    log(`Drafted ${made2.posts.filter((p) => p.text).length} posts from the article.`);
    return made2.posts.map((p) => ({
      platform: p.platform,
      text: p.text || null,
      error: p.error || null,
      open_in_skryvo: p.generation_id ? `${APP}/generate/social/${p.generation_id}` : null
    }));
  }
  if (platforms.length > MOST_DRAFT_PLATFORMS) {
    throw new Error(`Without an article, posts are drafted for up to ${MOST_DRAFT_PLATFORMS} platforms at a time.`);
  }
  const made = await call("POST", "/drafts", {
    topic: about.topic,
    platforms,
    pictures: inputs2.pictures === "true",
    ...about.url ? { link: about.url } : {},
    ...inputs2["brand-id"] ? { brand_id: inputs2["brand-id"] } : {}
  });
  log(`Drafted ${made.posts.filter((p) => p.text).length} posts.`);
  return made.posts.map((p) => ({
    platform: p.platform,
    text: p.text || null,
    error: p.error || null,
    open_in_skryvo: `${APP}/generate/social/${made.generation_id}`
  }));
}
async function run({ inputs: inputs2, event: event2, repository, call, log, sleep }) {
  const about = release(inputs2, event2, repository);
  log(`Writing about: ${about.topic}`);
  const wantsArticle = inputs2.article !== "false";
  const written = wantsArticle ? await article(call, log, about, inputs2, sleep) : null;
  const drafted = await posts(call, log, about, inputs2, written?.status);
  const done = written?.status.status === "done" ? written.status : null;
  return {
    "plan-id": written?.plan.plan_id ?? "",
    "article-id": written?.status.article_id ?? "",
    "article-status": written?.status.status ?? "",
    "article-title": done?.title ?? "",
    "article-url": done?.open_in_skryvo ?? "",
    posts: JSON.stringify(drafted ?? [])
  };
}

// src/skryvo.js
var BASE_URL = "https://api.skryvo.ai/api/v1/agent";
var SkryvoError = class extends Error {
  constructor(message, status) {
    super(message);
    this.name = "SkryvoError";
    this.status = status;
  }
};
function said(status, body) {
  if (typeof body?.detail === "string") return body.detail;
  if (Array.isArray(body?.details)) {
    return `Check the request: ${body.details.map((d) => `${d.field}: ${d.message}`).join("; ")}.`;
  }
  if (status === 401) return "The Skryvo API key was refused. Create a new one in Skryvo under Settings \u203A API & agents.";
  return body?.message || `Skryvo answered ${status}.`;
}
function parse(text) {
  try {
    return text ? JSON.parse(text) : void 0;
  } catch {
    return { message: text.slice(0, 200) };
  }
}
function client({ apiKey, baseUrl = BASE_URL, fetch = globalThis.fetch, sleep }) {
  const pause = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  return async function call(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: "application/json",
          "user-agent": "skryvo-action/1",
          ...body === void 0 ? {} : { "content-type": "application/json" }
        },
        body: body === void 0 ? void 0 : JSON.stringify(body),
        signal: AbortSignal.timeout(18e4)
      });
      const text = await response.text();
      const parsed = parse(text);
      if (response.ok) return parsed;
      if (response.status === 429 && attempt === 0) {
        await pause(Number(response.headers.get("retry-after") || 60) * 1e3);
        continue;
      }
      throw new SkryvoError(said(response.status, parsed), response.status);
    }
  };
}

// src/runner.js
import { appendFileSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
function inputs(names, env = process.env) {
  return Object.fromEntries(names.map((name) => [name, (env[`INPUT_${name.toUpperCase()}`] || "").trim()]));
}
function event(env = process.env) {
  return env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")) : {};
}
function setOutputs(outputs, env = process.env) {
  if (!env.GITHUB_OUTPUT) return;
  for (const [name, value] of Object.entries(outputs)) {
    const fence = `skryvo_${randomUUID()}`;
    appendFileSync(env.GITHUB_OUTPUT, `${name}<<${fence}
${value}
${fence}
`);
  }
}
function summary(markdown, env = process.env) {
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}
`);
}
var mask = (value) => value && process.stdout.write(`::add-mask::${value}
`);
var fail = (message) => {
  process.stdout.write(`::error::${message.replace(/\r?\n/g, "%0A")}
`);
  process.exitCode = 1;
};

// src/main.js
var NAMES = [
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
  "poll-seconds"
];
function report(out) {
  const posts2 = JSON.parse(out.posts);
  const lines = ["## Skryvo", ""];
  if (out["article-url"]) lines.push(`Article: [${out["article-title"]}](${out["article-url"]})`, "");
  else if (out["article-id"]) lines.push(`Article ${out["article-id"]}: ${out["article-status"]}`, "");
  for (const p of posts2) {
    lines.push(`**${p.platform}**${p.open_in_skryvo ? ` ([open in Skryvo](${p.open_in_skryvo}))` : ""}`, "");
    lines.push(p.text ? `> ${p.text.replace(/\n/g, "\n> ")}` : `Not written: ${p.error}`, "");
  }
  lines.push("Nothing is published or scheduled until you approve it in Skryvo.");
  return lines.join("\n");
}
var given = inputs(NAMES);
mask(given["api-key"]);
try {
  if (!given["api-key"]) throw new Error("Set api-key, for example `api-key: ${{ secrets.SKRYVO_API_KEY }}`.");
  const out = await run({
    inputs: given,
    event: event(),
    repository: process.env.GITHUB_REPOSITORY,
    call: client({ apiKey: given["api-key"] }),
    log: (line) => process.stdout.write(`${line}
`),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  });
  setOutputs(out);
  summary(report(out));
} catch (error) {
  fail(error.message);
}
