import { normalizeEvent } from "./events.js";
import { hasSeenDelivery, markStale, readState, recordEvent } from "./state.js";
import type { Env, PulseState } from "./types.js";
import { verifyGitHubSignature } from "./verify.js";

const decoder = new TextDecoder();

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function staleAfterDays(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "30", 10);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 3650 ? parsed : 30;
}

function publicStatus(state: PulseState) {
  const publicRepositories = Object.values(state.repositories)
    .filter((snapshot) => snapshot.visibility !== "private")
    .sort((left, right) => right.lastEventAt.localeCompare(left.lastEventAt));

  const publicNames = new Set(publicRepositories.map((item) => item.repository));
  const privateRepositoryCount = Object.values(state.repositories)
    .filter((snapshot) => snapshot.visibility === "private")
    .length;

  return {
    updatedAt: state.updatedAt,
    repositories: publicRepositories,
    recent: state.recent.filter((event) => publicNames.has(event.repository)),
    privateRepositoryCount,
  };
}

async function handleGitHub(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const signature = request.headers.get("x-hub-signature-256");
  const eventName = request.headers.get("x-github-event");
  const deliveryId = request.headers.get("x-github-delivery");
  if (!eventName || !deliveryId) {
    return json({ error: "missing_github_headers" }, 400);
  }

  const rawBody = await request.arrayBuffer();
  const verified = await verifyGitHubSignature(env.WEBHOOK_SECRET, signature, rawBody);
  if (!verified) {
    return json({ error: "invalid_signature" }, 401);
  }

  if (await hasSeenDelivery(env.REPULSE_STATE, deliveryId)) {
    return json({ accepted: true, duplicate: true }, 202);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(decoder.decode(rawBody));
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const normalized = normalizeEvent(eventName, payload, deliveryId, new Date().toISOString());
  if (!normalized) {
    return json({ accepted: true, ignored: true, event: eventName }, 202);
  }

  await recordEvent(env.REPULSE_STATE, normalized);
  return json({ accepted: true, event: normalized.snapshot.lastEvent }, 202);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true });
    }

    if (url.pathname === "/status" && request.method === "GET") {
      return json(publicStatus(await readState(env.REPULSE_STATE)));
    }

    if (url.pathname === "/github") {
      return handleGitHub(request, env);
    }

    return json({ error: "not_found" }, 404);
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(markStale(env.REPULSE_STATE, new Date(), staleAfterDays(env.STALE_AFTER_DAYS)));
  },
} satisfies ExportedHandler<Env>;
