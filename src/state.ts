import type { ProcessedEvent, PulseState } from "./types.js";

const STATE_KEY = "portfolio:state";
const DELIVERY_PREFIX = "delivery:";
const MAX_RECENT_EVENTS = 12;
const DELIVERY_TTL_SECONDS = 60 * 60 * 24 * 14;

const emptyState = (): PulseState => ({
  updatedAt: new Date(0).toISOString(),
  repositories: {},
  recent: [],
});

export async function readState(namespace: KVNamespace): Promise<PulseState> {
  const raw = await namespace.get(STATE_KEY);
  if (!raw) {
    return emptyState();
  }

  try {
    const parsed = JSON.parse(raw) as PulseState;
    if (!parsed || typeof parsed !== "object" || !parsed.repositories || !Array.isArray(parsed.recent)) {
      return emptyState();
    }
    return parsed;
  } catch {
    return emptyState();
  }
}

export async function hasSeenDelivery(namespace: KVNamespace, deliveryId: string): Promise<boolean> {
  return (await namespace.get(`${DELIVERY_PREFIX}${deliveryId}`)) !== null;
}

export async function recordEvent(
  namespace: KVNamespace,
  event: ProcessedEvent,
): Promise<PulseState> {
  const state = await readState(namespace);
  state.repositories[event.snapshot.repository] = event.snapshot;
  state.recent = [
    event.recent,
    ...state.recent.filter((item) => item.deliveryId !== event.recent.deliveryId),
  ].slice(0, MAX_RECENT_EVENTS);
  state.updatedAt = event.snapshot.lastEventAt;

  await namespace.put(STATE_KEY, JSON.stringify(state));
  await namespace.put(`${DELIVERY_PREFIX}${event.snapshot.deliveryId}`, "1", {
    expirationTtl: DELIVERY_TTL_SECONDS,
  });

  return state;
}

export async function markStale(
  namespace: KVNamespace,
  now: Date,
  staleAfterDays: number,
): Promise<PulseState> {
  const state = await readState(namespace);
  const threshold = now.getTime() - staleAfterDays * 24 * 60 * 60 * 1000;
  let changed = false;

  for (const snapshot of Object.values(state.repositories)) {
    const stale = Number.isNaN(Date.parse(snapshot.lastEventAt))
      || Date.parse(snapshot.lastEventAt) < threshold;
    if (snapshot.stale !== stale) {
      snapshot.stale = stale;
      changed = true;
    }
  }

  if (changed) {
    state.updatedAt = now.toISOString();
    await namespace.put(STATE_KEY, JSON.stringify(state));
  }

  return state;
}
