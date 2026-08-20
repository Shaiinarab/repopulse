import type { ProcessedEvent, SupportedEvent } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown, maxLength = 160): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, maxLength)
    : undefined;
}

function supportedEvent(value: string): value is SupportedEvent {
  return value === "ping" || value === "push" || value === "pull_request";
}

export function normalizeEvent(
  eventName: string,
  payload: unknown,
  deliveryId: string,
  now: string,
): ProcessedEvent | null {
  if (!supportedEvent(eventName) || !isRecord(payload)) {
    return null;
  }

  const repository = isRecord(payload.repository) ? payload.repository : null;
  const repositoryName = repository ? text(repository.full_name) : undefined;
  if (!repositoryName) {
    return null;
  }

  const visibility = repository?.private === true
    ? "private"
    : repository?.private === false
      ? "public"
      : "unknown";

  let reference: string | undefined;
  let action: string | undefined;
  let commitCount: number | undefined;

  if (eventName === "push") {
    reference = text(payload.ref);
    commitCount = Array.isArray(payload.commits)
      ? Math.min(payload.commits.length, 999)
      : undefined;
  }

  if (eventName === "pull_request") {
    action = text(payload.action, 48);
    reference = typeof payload.number === "number" && Number.isSafeInteger(payload.number)
      ? `#${payload.number}`
      : undefined;
  }

  const snapshot = {
    repository: repositoryName,
    visibility,
    lastEvent: eventName,
    lastEventAt: now,
    deliveryId,
    reference,
    action,
    commitCount,
    stale: false,
  } as const;

  return {
    snapshot,
    recent: {
      repository: repositoryName,
      event: eventName,
      at: now,
      deliveryId,
      reference,
      action,
    },
  };
}
