export const BASE_URL = "https://api.skryvo.ai/api/v1/agent";

export class SkryvoError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "SkryvoError";
    this.status = status;
  }
}

function said(status, body) {
  if (typeof body?.detail === "string") return body.detail;
  if (Array.isArray(body?.details)) {
    return `Check the request: ${body.details.map((d) => `${d.field}: ${d.message}`).join("; ")}.`;
  }
  if (status === 401) return "The Skryvo API key was refused. Create a new one in Skryvo under Settings › API & agents.";
  return body?.message || `Skryvo answered ${status}.`;
}

function parse(text) {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return { message: text.slice(0, 200) };
  }
}

/** The agent API with a key; a rate limit is waited out once, as the server asks. */
export function client({ apiKey, baseUrl = BASE_URL, fetch = globalThis.fetch, sleep }) {
  const pause = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  return async function call(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: "application/json",
          "user-agent": "skryvo-action/1",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
      const text = await response.text();
      const parsed = parse(text);
      if (response.ok) return parsed;
      if (response.status === 429 && attempt === 0) {
        await pause(Number(response.headers.get("retry-after") || 60) * 1000);
        continue;
      }
      throw new SkryvoError(said(response.status, parsed), response.status);
    }
  };
}
