import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";
import { verifyGitHubSignature } from "../src/verify.js";
import type { Env } from "../src/types.js";

class MemoryKV {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

const encoder = new TextEncoder();

async function signature(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hex = Array.from(new Uint8Array(signed), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}

function testEnv(): Env {
  return {
    WEBHOOK_SECRET: "test-secret",
    REPULSE_STATE: new MemoryKV() as unknown as KVNamespace,
    STALE_AFTER_DAYS: "30",
  };
}

function workerHandler() {
  return worker as unknown as {
    fetch(request: Request, env: Env): Promise<Response>;
    scheduled(
      controller: ScheduledController,
      env: Env,
      ctx: ExecutionContext,
    ): Promise<void>;
  };
}

test("verifies GitHub's published HMAC test vector", async () => {
  const body = encoder.encode("Hello, World!").buffer;
  const valid = await verifyGitHubSignature(
    "It's a Secret to Everybody",
    "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
    body,
  );
  assert.equal(valid, true);
});

test("rejects a malformed signature", async () => {
  const valid = await verifyGitHubSignature("test-secret", "sha256=not-hex", encoder.encode("{}").buffer);
  assert.equal(valid, false);
});

test("accepts a signed push, ignores its replay, and exposes sanitized public state", async () => {
  const env = testEnv();
  const payload = JSON.stringify({
    ref: "refs/heads/main",
    commits: [{ id: "a" }, { id: "b" }],
    repository: { full_name: "Shaiinarab/Simorgh-edge-gateway", private: false },
  });
  const request = new Request("https://repopulse.test/github", {
    method: "POST",
    body: payload,
    headers: {
      "x-github-event": "push",
      "x-github-delivery": "delivery-001",
      "x-hub-signature-256": await signature(env.WEBHOOK_SECRET, payload),
    },
  });

  const handler = workerHandler();
  const first = await handler.fetch(request, env);
  assert.equal(first.status, 202);
  assert.deepEqual(await first.json(), { accepted: true, event: "push" });

  const replayRequest = new Request("https://repopulse.test/github", {
    method: "POST",
    body: payload,
    headers: {
      "x-github-event": "push",
      "x-github-delivery": "delivery-001",
      "x-hub-signature-256": await signature(env.WEBHOOK_SECRET, payload),
    },
  });
  const replay = await handler.fetch(replayRequest, env);
  assert.equal(replay.status, 202);
  assert.deepEqual(await replay.json(), { accepted: true, duplicate: true });

  const status = await handler.fetch(new Request("https://repopulse.test/status"), env);
  const body = await status.json() as { repositories: Array<{ repository: string; commitCount: number }>; privateRepositoryCount: number };
  assert.equal(status.status, 200);
  assert.equal(body.repositories.length, 1);
  assert.equal(body.repositories[0].repository, "Shaiinarab/Simorgh-edge-gateway");
  assert.equal(body.repositories[0].commitCount, 2);
  assert.equal(body.privateRepositoryCount, 0);
});

test("accepts a signed form-encoded push delivery", async () => {
  const env = testEnv();
  const payload = JSON.stringify({
    ref: "refs/heads/main",
    commits: [{ id: "c" }],
    repository: { full_name: "Shaiinarab/Log-Sentinel", private: false },
  });
  const formBody = `payload=${encodeURIComponent(payload)}`;
  const request = new Request("https://repopulse.test/github", {
    method: "POST",
    body: formBody,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-github-event": "push",
      "x-github-delivery": "delivery-form-001",
      "x-hub-signature-256": await signature(env.WEBHOOK_SECRET, formBody),
    },
  });

  const response = await workerHandler().fetch(request, env);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true, event: "push" });
});

test("does not disclose a private repository name in the public status response", async () => {
  const env = testEnv();
  const payload = JSON.stringify({
    action: "opened",
    number: 17,
    repository: { full_name: "Shaiinarab/private-idea", private: true },
  });
  const request = new Request("https://repopulse.test/github", {
    method: "POST",
    body: payload,
    headers: {
      "x-github-event": "pull_request",
      "x-github-delivery": "delivery-private",
      "x-hub-signature-256": await signature(env.WEBHOOK_SECRET, payload),
    },
  });

  const handler = workerHandler();
  assert.equal((await handler.fetch(request, env)).status, 202);
  const status = await handler.fetch(new Request("https://repopulse.test/status"), env);
  const body = await status.text();
  assert.equal(body.includes("private-idea"), false);
  assert.equal(body.includes("privateRepositoryCount"), true);
});

test("rejects an unsigned delivery before parsing it", async () => {
  const handler = workerHandler();
  const response = await handler.fetch(new Request("https://repopulse.test/github", {
    method: "POST",
    body: "not-json",
    headers: {
      "x-github-event": "push",
      "x-github-delivery": "unsigned",
    },
  }), testEnv());
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "invalid_signature" });
});

test("marks an old public project as stale through the scheduled handler", async () => {
  const kv = new MemoryKV();
  const env: Env = {
    WEBHOOK_SECRET: "test-secret",
    REPULSE_STATE: kv as unknown as KVNamespace,
    STALE_AFTER_DAYS: "30",
  };
  await kv.put("portfolio:state", JSON.stringify({
    updatedAt: "2026-01-01T00:00:00.000Z",
    repositories: {
      "Shaiinarab/old-project": {
        repository: "Shaiinarab/old-project",
        visibility: "public",
        lastEvent: "push",
        lastEventAt: "2026-01-01T00:00:00.000Z",
        deliveryId: "old-delivery",
        stale: false,
      },
    },
    recent: [],
  }));

  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
    passThroughOnException() {},
  } as unknown as ExecutionContext;

  await workerHandler().scheduled({} as ScheduledController, env, ctx);
  await Promise.all(pending);

  const response = await workerHandler().fetch(new Request("https://repopulse.test/status"), env);
  const state = await response.json() as { repositories: Array<{ stale: boolean }> };
  assert.equal(state.repositories[0].stale, true);
});
