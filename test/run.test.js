import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { release, run } from "../src/run.js";
import { client } from "../src/skryvo.js";
import { inputs, setOutputs } from "../src/runner.js";

const spec = JSON.parse(readFileSync(new URL("./openapi.json", import.meta.url), "utf8"));
const P = "/api/v1/agent";

const example = (method, path) => {
  const op = spec.paths[`${P}${path}`][method.toLowerCase()];
  const code = Object.keys(op.responses).find((c) => c.startsWith("2"));
  return structuredClone(op.responses[code].content["application/json"].example);
};

const RELEASE = {
  release: {
    tag_name: "v2.4.0",
    name: "Faster exports",
    body: "- Exports run in the background\n- CSV now keeps line breaks",
    html_url: "https://github.com/acme/widget/releases/tag/v2.4.0",
  },
};

/** A Skryvo stand-in answering from the published spec's examples, recording each call. */
function fake(overrides = {}) {
  const calls = [];
  let polls = 0;
  const call = async (method, path, body) => {
    calls.push({ method, path, body });
    const key = `${method} ${path}`;
    if (overrides[key]) return overrides[key](body);
    if (key === "POST /articles") return { ...example("POST", "/articles"), article_id: "pl_91ab3e", status: "writing" };
    if (method === "GET" && path.startsWith("/articles/")) {
      polls++;
      return polls < 2 ? { article_id: "pl_91ab3e", status: "writing", stage: "Checking facts" } : example("GET", "/articles/{article_id}");
    }
    if (path.endsWith("/posts") && method === "POST") return example("POST", "/articles/{article_id}/posts");
    return example(method, path);
  };
  return { call, calls };
}

const base = { inputs: { platforms: "linkedin, x" }, event: RELEASE, repository: "acme/widget", log: () => {}, sleep: async () => {} };

test("a release becomes a topic, notes and a source page", () => {
  const about = release({}, RELEASE, "acme/widget");
  assert.equal(about.topic, "What's new in widget v2.4.0 Faster exports");
  assert.match(about.notes, /Exports run in the background/);
  assert.equal(about.url, RELEASE.release.html_url);
});

test("inputs override the release, and long notes are cut to what the API takes", () => {
  const about = release({ topic: "Our launch", notes: "x".repeat(5000) }, {}, "acme/widget");
  assert.equal(about.topic, "Our launch");
  assert.equal(about.notes.length, 2000);
  assert.throws(() => release({}, {}, "acme/widget"), /run this on a release/);
  assert.throws(() => release({ topic: "Launch" }, {}, "acme/widget"), /notes, or a page/);
});

test("plans and writes the article from the notes, waits, then drafts posts from it", async () => {
  const { call, calls } = fake();
  const out = await run({ ...base, call });
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`),
    ["POST /articles/plan", "POST /articles", "GET /articles/pl_91ab3e", "GET /articles/pl_91ab3e", "POST /articles/pl_91ab3e/posts"],
  );
  assert.deepEqual(calls[0].body, {
    topic: "What's new in widget v2.4.0 Faster exports",
    only_you: RELEASE.release.body,
    sources: [RELEASE.release.html_url],
  });
  assert.deepEqual(calls[4].body, { platforms: ["linkedin", "x"] });
  assert.equal(out["article-status"], "done");
  assert.match(out["article-url"], /^https:\/\/app\.skryvo\.ai\/generate\/blog\//);
  const posts = JSON.parse(out.posts);
  assert.ok(posts.length >= 1 && posts[0].text);
  assert.match(posts[0].open_in_skryvo, /^https:\/\/app\.skryvo\.ai\/generate\/social\//);
});

test("never publishes or schedules", async () => {
  const { call, calls } = fake();
  await run({ ...base, call });
  assert.ok(calls.every((c) => !/\/publish$/.test(c.path) && c.path !== "/posts"));
});

test("with article false, drafts posts straight from the release with its link", async () => {
  const { call, calls } = fake();
  const out = await run({ ...base, inputs: { article: "false", platforms: "linkedin" }, call });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["POST /drafts"]);
  assert.deepEqual(calls[0].body, {
    topic: "What's new in widget v2.4.0 Faster exports",
    platforms: ["linkedin"],
    pictures: false,
    link: RELEASE.release.html_url,
  });
  assert.equal(out["article-id"], "");
  assert.equal(JSON.parse(out.posts)[0].platform, "linkedin");
  await assert.rejects(run({ ...base, inputs: { article: "false", platforms: "a,b,c,d,e" }, call }), /up to 4 platforms/);
});

test("a failed article fails the step and says it was not charged", async () => {
  const { call } = fake({
    "GET /articles/pl_91ab3e": () => ({ article_id: "pl_91ab3e", status: "failed", error: "The article stopped before it finished.", charged: false }),
  });
  await assert.rejects(run({ ...base, call }), /not written: The article stopped before it finished\. It was not charged\./);
});

test("an article still writing at the deadline fails with its id", async () => {
  const { call } = fake({ "GET /articles/pl_91ab3e": () => ({ article_id: "pl_91ab3e", status: "writing" }) });
  await assert.rejects(run({ ...base, inputs: { "timeout-minutes": "0.0001" }, call }), /still being written.*pl_91ab3e/);
});

test("wait false returns at once with the article writing and drafts no posts from it", async () => {
  const { call } = fake();
  const out = await run({ ...base, inputs: { wait: "false", platforms: "linkedin" }, call });
  assert.equal(out["article-status"], "writing");
  assert.equal(out["article-url"], "");
});

test("the client sends the key, retries a rate limit once and passes Skryvo's refusal on", async () => {
  const seen = [];
  const answers = [
    new Response(JSON.stringify({ message: "slow down" }), { status: 429, headers: { "retry-after": "1" } }),
    new Response(JSON.stringify({ detail: "This needs 2 generations and 1 are left this month." }), { status: 422 }),
  ];
  const call = client({
    apiKey: "sk_skryvo_t",
    fetch: async (url, init) => (seen.push({ url, init }), answers.shift()),
    sleep: async () => {},
  });
  await assert.rejects(call("POST", "/articles", { plan_id: "p" }), /This needs 2 generations and 1 are left this month\./);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].init.headers.authorization, "Bearer sk_skryvo_t");
  assert.equal(seen[0].url, "https://api.skryvo.ai/api/v1/agent/articles");
});

test("inputs and outputs follow the runner's conventions", () => {
  assert.deepEqual(inputs(["api-key", "platforms"], { "INPUT_API-KEY": " k ", INPUT_PLATFORMS: "x" }), { "api-key": "k", platforms: "x" });
  const file = join(mkdtempSync(join(tmpdir(), "skryvo-action-")), "out");
  writeFileSync(file, "");
  setOutputs({ posts: '[{"text":"a\\nb"}]' }, { GITHUB_OUTPUT: file });
  assert.match(readFileSync(file, "utf8"), /^posts<<skryvo_[\w-]+\n\[\{"text":"a\\nb"\}\]\nskryvo_[\w-]+\n$/);
});

test("every route the action calls is in the published spec", () => {
  const routes = new Set(Object.keys(spec.paths).map((p) => p.slice(P.length).replace(/\{[^}]+\}/g, "{}")));
  for (const route of ["/articles/plan", "/articles", "/articles/{}", "/articles/{}/posts", "/drafts"]) {
    assert.ok(routes.has(route), route);
  }
});
