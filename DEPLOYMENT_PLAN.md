# RepoPulse Publication Plan

**Current state:** The source exists only at `/home/ubuntu/shahin-portfolio-modernization/repopulse` and has passed six local tests, strict type checking, a Worker dry-run, and a production dependency audit. No remote resource has been created or modified.

## Proposed first rollout

The rollout is intentionally narrow: one new Worker, one new KV namespace, one encrypted webhook secret, one new source repository, and GitHub webhooks only for five active public repositories. RepoPulse will observe events; it will not write to GitHub or trigger deployments.

| System | Exact action | Configuration | Impact |
|---|---|---|---|
| GitHub | Create `Shaiinarab/repopulse` as a **public** repository and push the local source. | The repository contains no real IDs, KV data, webhook secret, or API token. | Creates a visible, reusable portfolio project. |
| Cloudflare | Create one KV namespace named `REPULSE_STATE`. | Stores compact event summaries and 14-day delivery deduplication markers. | New isolated state only; does not use existing `CONTEXT_STORE`, `iot_db`, or Nahan resources. |
| Cloudflare | Deploy a new Worker named `repopulse`. | Public `workers.dev` endpoint; `GET /health`, `GET /status`, and verified `POST /github`. | Adds a new public read endpoint. No custom domain, route, or existing Worker is touched. |
| Cloudflare | Store a fresh high-entropy `WEBHOOK_SECRET` as an encrypted Worker secret. | Generated locally at deployment time; never committed or returned in a report. | Enables authentication of GitHub deliveries. |
| Cloudflare | Enable cron `15 6 * * *` UTC. | One daily stale-project evaluation. | Small scheduled edge workload; no external network calls. |
| GitHub | Create individual repository webhooks pointing to `https://repopulse.<account-subdomain>.workers.dev/github`. | Content type JSON, secret `WEBHOOK_SECRET`, only `push` and `pull_request` events, active; leave “send me everything” disabled. | GitHub begins sending authenticated metadata deliveries to RepoPulse. |

## Initial webhook scope

| Repository | Reason for inclusion | Event scope |
|---|---|---|
| `Simorgh-edge-gateway` | Active Cloudflare flagship; validated local baseline. | Push and pull request |
| `Log-Sentinel` | Focused developer tool with passing tests. | Push and pull request |
| `Ararat-platform` | Active product candidate needing visibility while repaired. | Push and pull request |
| `mashreghi_asil` | Canonical public Oudiverse implementation. | Push and pull request |
| `shahinarab78` | Personal portfolio landing page. | Push and pull request |

Private repositories are intentionally excluded from the first webhook rollout. RepoPulse can process a private delivery without exposing the repository name in public status, but excluding them now limits data movement and makes verification simpler.

## Security and data boundary

GitHub documents that a webhook sender signs each delivery with the configured secret in the `X-Hub-Signature-256` header. RepoPulse verifies the raw body before parsing it, uses only the supported event types, and rejects invalid signatures.[1] Public status excludes private repository names; raw payloads, commit messages, source content, API tokens, and the webhook secret are never written to KV.

The Worker needs no GitHub API token, no Cloudflare account token at runtime, no deploy-hook URL, and no permission to modify a repository or deploy another Worker.

## Rollback plan

| Situation | Immediate response | Result |
|---|---|---|
| Bad or unexpected deliveries | Disable the affected GitHub webhook first. | Stops inbound data without deleting source or state. |
| Webhook-secret concern | Replace the Worker secret and update the matching GitHub webhook secret. | Invalidates the previous signature secret. |
| Worker issue | Roll back to the previous Worker version or delete the new `repopulse` Worker. | Does not affect existing Workers. |
| Permanent retirement | Disable/delete the five GitHub webhooks, delete `repopulse`, then delete `REPULSE_STATE` after confirming no retained state is needed. | Full removal; no existing resource is changed. |

## Explicit approval required

Proceeding requires approval for all of the following external changes: creating one **public GitHub repository**, creating one **public Cloudflare Worker endpoint**, creating a new **KV namespace**, uploading one **Worker secret**, enabling one **daily cron**, and adding **ten GitHub webhook subscriptions** across the five named repositories. The source and validation result are complete; no action will be taken until the user explicitly approves this exact plan or provides changes.

## References

[1]: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries "GitHub Docs — Validating webhook deliveries"
