# Skryvo release article and posts

A GitHub Action that turns each release into an article and social posts in your brand's voice, written by
[Skryvo](https://skryvo.ai) and left in Skryvo for your approval. It publishes and schedules nothing.

On a release, it plans an article from the release notes and the release page, has Skryvo write it (your notes
are the facts only you know, used in your words; claims from other sources are checked against those sources),
then drafts one post per platform you name from the finished article. The job summary shows the article and each post with a link to open
it in Skryvo, where you edit, approve and schedule.

Skryvo is a paid service with a 7-day free trial on Hobby and Pro (https://skryvo.ai/pricing/). An article uses
2 generations and turning it into posts 1 more; planning is free. Docs: https://skryvo.ai/docs/

## Use it

1. In Skryvo, create an API key under [Settings › API & agents](https://app.skryvo.ai/settings/agents).
2. In your repository, add it as the secret `SKRYVO_API_KEY` (Settings › Secrets and variables › Actions).
3. Add `.github/workflows/skryvo.yml`:

```yaml
name: Release article
on:
  release:
    types: [published]
  workflow_dispatch:
    inputs:
      topic:
        description: What to write about
        required: true
      source-url:
        description: A public page with the details
        required: true

jobs:
  write:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: Skryvo/skryvo-action@v1
        id: skryvo
        with:
          api-key: ${{ secrets.SKRYVO_API_KEY }}
          platforms: linkedin, bluesky
          topic: ${{ inputs.topic }}
          source-url: ${{ inputs.source-url }}
      - run: echo "Review it at ${{ steps.skryvo.outputs.article-url }}"
```

A run takes about five minutes, most of it Skryvo writing and checking the article. Its log:

```
Writing about: What's new in widget v2.4.0 Faster exports
Planned "Faster exports in widget 2.4: background jobs and CSV line breaks" (5 sections).
Writing the article; Skryvo says about 4 minutes.
Still writing: Checking facts.
Article ready: "Faster exports in widget 2.4: background jobs and CSV line breaks", 1184 words, score 86.
Drafted 2 posts from the article.
```

## Inputs

| Input | Default | What it does |
|---|---|---|
| `api-key` | required | A Skryvo API key, from a secret |
| `brand-id` | the account's default brand | The brand to write as |
| `article` | `true` | `false` skips the article and drafts posts straight from the release, with its link |
| `platforms` | none | Platforms to draft posts for, comma-separated, as Skryvo names them (`linkedin`, `x`, `bluesky`, `threads`, …); empty drafts no posts |
| `pictures` | `false` | With `article: false`, `true` designs a picture with each post (image credits) |
| `topic` | `What's new in <repo> <tag> <name>` | What to write about, up to 200 characters |
| `notes` | the release notes | The facts to write from, up to 2000 characters |
| `source-url` | the release's page | A public page Skryvo reads for the article |
| `wait` | `true` | `false` returns once the article is started, without posts from it |
| `timeout-minutes` | `25` | How long to wait for the article |
| `poll-seconds` | `30` | How often to check on it |

Without an article, posts are drafted for up to four platforms at a time. With one, the platforms Skryvo turns an
article into are LinkedIn, X, Instagram, Facebook, TikTok, Bluesky, Threads and Pinterest, and your plan sets how
many at once.

## Outputs

| Output | Example |
|---|---|
| `plan-id` | `pl_91ab3e` |
| `article-id` | `pl_91ab3e` |
| `article-status` | `done`, `writing` (with `wait: false`) or `failed` |
| `article-title` | `Faster exports in widget 2.4: background jobs and CSV line breaks` |
| `article-url` | `https://app.skryvo.ai/generate/blog/gen_a7c2f0` |
| `posts` | `[{"platform":"linkedin","text":"…","error":null,"open_in_skryvo":"https://app.skryvo.ai/generate/social/gen_…"}]` |

## Errors

The step fails with Skryvo's own sentence when it refuses, for example "This needs 2 generations and 1 are left
this month." A refused key says to create a new one. A failed article is not charged. A rate limit is waited out
once, as Skryvo asks. The key is masked in the log.

## Develop

```bash
npm install
npm test        # the core, offline, against the examples in Skryvo's published API description
npm run build   # bundles src/ into dist/index.js, which is committed
```

`test/openapi.json` is Skryvo's published API description (`https://api.skryvo.ai/openapi.json`); replace it to
follow a new version. The action has no runtime dependencies.

Issues: https://github.com/Skryvo/skryvo-action/issues · support@skryvo.ai

## License

MIT © Flutter Studio LLC
