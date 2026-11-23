const APP = "https://app.skryvo.ai";
const TOPIC_CHARS = 200;
const NOTES_CHARS = 2000;
const MOST_DRAFT_PLATFORMS = 4;

const clip = (text, most) => (text.length <= most ? text : `${text.slice(0, most - 1).trimEnd()}…`);
const list = (value) =>
  [...new Set((value || "").split(/[\s,]+/).map((p) => p.trim().toLowerCase()).filter(Boolean))];

/** What the run writes about: the release that triggered it, or what the workflow passed in. */
export function release(inputs, event, repository) {
  const r = event?.release;
  const repo = (repository || "").split("/").pop();
  const notes = (inputs.notes || r?.body || "").trim();
  const url = (inputs["source-url"] || r?.html_url || "").trim();
  const named = r ? [repo, r.tag_name, r.name && r.name !== r.tag_name ? r.name : ""].filter(Boolean).join(" ") : "";
  const topic = (inputs.topic || (named && `What's new in ${named}`) || "").trim();
  if (!topic) {
    throw new Error("Nothing to write about: run this on a release, or pass topic (and notes or source-url).");
  }
  if (!notes && !url) throw new Error("Pass the release notes in notes, or a page to read in source-url.");
  return { topic: clip(topic, TOPIC_CHARS), notes: clip(notes, NOTES_CHARS), url };
}

async function article(call, log, about, inputs, sleep) {
  const plan = await call("POST", "/articles/plan", {
    topic: about.topic,
    ...(inputs["brand-id"] ? { brand_id: inputs["brand-id"] } : {}),
    ...(about.notes ? { only_you: about.notes } : {}),
    ...(about.url ? { sources: [about.url] } : {}),
  });
  log(`Planned "${plan.headline}" (${plan.outline?.length ?? 0} sections).`);
  let status = await call("POST", "/articles", { plan_id: plan.plan_id });
  log(`Writing the article; Skryvo says about ${status.minutes ?? 4} minutes.`);
  if (inputs.wait === "false") return { plan, status };
  const interval = Number(inputs["poll-seconds"] || 30) * 1000;
  const deadline = Date.now() + Number(inputs["timeout-minutes"] || 25) * 60_000;
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

async function posts(call, log, about, inputs, written) {
  const platforms = list(inputs.platforms);
  if (!platforms.length) return null;
  if (written?.status === "done") {
    const made = await call("POST", `/articles/${encodeURIComponent(written.article_id)}/posts`, { platforms });
    log(`Drafted ${made.posts.filter((p) => p.text).length} posts from the article.`);
    return made.posts.map((p) => ({
      platform: p.platform,
      text: p.text || null,
      error: p.error || null,
      open_in_skryvo: p.generation_id ? `${APP}/generate/social/${p.generation_id}` : null,
    }));
  }
  if (platforms.length > MOST_DRAFT_PLATFORMS) {
    throw new Error(`Without an article, posts are drafted for up to ${MOST_DRAFT_PLATFORMS} platforms at a time.`);
  }
  const made = await call("POST", "/drafts", {
    topic: about.topic,
    platforms,
    pictures: inputs.pictures === "true",
    ...(about.url ? { link: about.url } : {}),
    ...(inputs["brand-id"] ? { brand_id: inputs["brand-id"] } : {}),
  });
  log(`Drafted ${made.posts.filter((p) => p.text).length} posts.`);
  return made.posts.map((p) => ({
    platform: p.platform,
    text: p.text || null,
    error: p.error || null,
    open_in_skryvo: `${APP}/generate/social/${made.generation_id}`,
  }));
}

/** Plans and writes the article, drafts the posts, and returns the outputs; nothing is published or scheduled. */
export async function run({ inputs, event, repository, call, log, sleep }) {
  const about = release(inputs, event, repository);
  log(`Writing about: ${about.topic}`);
  const wantsArticle = inputs.article !== "false";
  const written = wantsArticle ? await article(call, log, about, inputs, sleep) : null;
  const drafted = await posts(call, log, about, inputs, written?.status);
  const done = written?.status.status === "done" ? written.status : null;
  return {
    "plan-id": written?.plan.plan_id ?? "",
    "article-id": written?.status.article_id ?? "",
    "article-status": written?.status.status ?? "",
    "article-title": done?.title ?? "",
    "article-url": done?.open_in_skryvo ?? "",
    posts: JSON.stringify(drafted ?? []),
  };
}
