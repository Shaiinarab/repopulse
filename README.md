# RepoPulse

RepoPulse is a minimalist Cloudflare Worker that turns authenticated GitHub webhook deliveries into a compact portfolio activity signal. It deliberately avoids repository writes, GitHub API tokens, deployment hooks, source execution, and full webhook-payload retention.

## What version 1 does

| Surface | Behavior |
|---|---|
| `POST /github` | Verifies the raw delivery with HMAC SHA-256 before parsing JSON. It handles only `ping`, `push`, and `pull_request` events. |
| `GET /health` | Returns a fixed health response without revealing configuration or secret state. |
| `GET /status` | Returns sanitized activity for public repositories. Private repository names are excluded; only a private-project count is exposed. |
| Scheduled handler | Marks stale projects using the configured day threshold. It does not call GitHub or alter repositories. |

## Security model

GitHub signs configured webhook deliveries using the `X-Hub-Signature-256` header. RepoPulse verifies the exact raw request bytes with a Worker-stored secret before it parses payload JSON.[1] The state store retains only repository metadata needed for a status view, not the raw payload, commit messages, secret values, or source content.

> **Do not** put `WEBHOOK_SECRET`, a deploy-hook URL, an API token, or a real KV namespace ID in source control.

## Local validation

```bash
npm ci --ignore-scripts
npm run typecheck
npm run test
```

The test suite validates GitHub’s published HMAC test vector, malformed signatures, signed push handling, replay detection, and private-repository name exclusion.

## Deployment prerequisites

The repository needs an approved Cloudflare Worker, one dedicated KV namespace, one Worker secret named `WEBHOOK_SECRET`, and a GitHub webhook configured only for the chosen repositories and event types. The placeholder KV IDs in `wrangler.toml` must be replaced only after those resources exist. A daily `06:15 UTC` stale-project check is declared but should not be enabled until deployment approval.

## Intentional non-goals

RepoPulse does not create issues, modify repository settings, deploy other Workers, proxy traffic, fetch arbitrary webhook-supplied URLs, or contain an administrative write endpoint. Those capabilities would increase its blast radius and are intentionally deferred.

## References

[1]: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries "GitHub Docs — Validating webhook deliveries"
