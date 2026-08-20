export interface Env {
  REPULSE_STATE: KVNamespace;
  WEBHOOK_SECRET: string;
  STALE_AFTER_DAYS?: string;
}

export type SupportedEvent = "ping" | "push" | "pull_request";

export interface RepositorySnapshot {
  repository: string;
  visibility: "public" | "private" | "unknown";
  lastEvent: SupportedEvent;
  lastEventAt: string;
  deliveryId: string;
  reference?: string;
  action?: string;
  commitCount?: number;
  stale: boolean;
}

export interface RecentEvent {
  repository: string;
  event: SupportedEvent;
  at: string;
  deliveryId: string;
  reference?: string;
  action?: string;
}

export interface PulseState {
  updatedAt: string;
  repositories: Record<string, RepositorySnapshot>;
  recent: RecentEvent[];
}

export interface ProcessedEvent {
  snapshot: RepositorySnapshot;
  recent: RecentEvent;
}
