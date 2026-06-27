# Deployment Runbook — TechTrax MCP Server

DevOps reference for deploying the MCP server. The app is a stateless-ish
NestJS HTTP service (one caveat: in-memory MCP sessions — see [Scaling](#scaling)).

---

## 1. What it is

- Node.js 24 service (see [`.nvmrc`](.nvmrc) / `engines` in `package.json`).
- Listens on `PORT` (default `3100`), path `POST /mcp`.
- Outbound dependency: the **TechTrax Express backend** (`BACKEND_BASE_URL`).
- No database, no disk state, no message broker.

## 2. Build & run

### Docker (recommended)

```bash
docker build -t techtrax/mcp-server:<tag> .
docker run -d --name techtrax-mcp \
  --env-file .env.production \
  -p 3100:3100 \
  techtrax/mcp-server:<tag>
```

The image is multi-stage (build → prune dev deps → distroless-ish alpine
runtime), runs as the non-root `node` user, and ships a `HEALTHCHECK`.

### docker compose

```bash
cp .env.production.example .env.production   # fill in real values
docker compose up -d --build
```

### Bare metal / PM2

```bash
npm ci --omit=dev      # after a separate build, or build then prune
npm run build
NODE_ENV=production node dist/main
```

## 3. Configuration & secrets

- Full variable reference: see the table in [README.md](README.md#configuration).
- Template: [`.env.production.example`](.env.production.example).
- **Required in production:** `BACKEND_BASE_URL`, `BACKEND_API_KEY`,
  `MCP_CLIENT_API_KEY`. The process **fails fast** at boot if any are missing or
  invalid — a crash-looping container almost always means a bad env value (check
  the first log line).
- Inject secrets via your manager (k8s `Secret`, AWS SSM/Secrets Manager, Vault).
  Never bake them into the image; `.env*` files (except `*.example`) are
  gitignored and dockerignored.
- Generate the inbound key: `openssl rand -hex 32`. Clients must send it as the
  `x-api-key` header.

## 4. Health probes

| Probe | Endpoint | Meaning | Use for |
| --- | --- | --- | --- |
| Liveness | `GET /healthz` | Process is up (static `200`) | restart-if-dead |
| Readiness | `GET /healthz/ready` | Backend reachable (`200`/`503`) | route-traffic gate |

Kubernetes example:

```yaml
livenessProbe:
  httpGet: { path: /healthz, port: 3100 }
  initialDelaySeconds: 10
  periodSeconds: 15
readinessProbe:
  httpGet: { path: /healthz/ready, port: 3100 }
  initialDelaySeconds: 10
  periodSeconds: 15
  failureThreshold: 3
```

> Readiness flips to `503` when the backend is down, so the orchestrator stops
> sending MCP traffic to an instance that can't fulfil it. Don't use
> `/healthz/ready` for liveness, or a backend outage would needlessly restart
> healthy pods.

## 5. Networking & TLS

- Terminate TLS at the ingress/LB; the app speaks plain HTTP internally.
- Set `TRUST_PROXY=true` behind any proxy so client IPs in logs are accurate.
- Expose only `POST /mcp` (auth-gated) and the `/healthz*` probes.
- Browser clients: set `CORS_ALLOWED_ORIGINS`. Server-to-server: leave it empty.
- Ensure the MCP server can reach `BACKEND_BASE_URL` (security group / network
  policy / same compose network).

## 6. Scaling

⚠️ **The streamable-HTTP transport stores session state in memory.** Plain
round-robin across replicas will break sessions mid-conversation. Options:

1. **Single replica** (simplest; vertical scale). Fine for current load.
2. **Multiple replicas + sticky sessions** — enable session affinity on the LB
   keyed on the `Mcp-Session-Id` header (or cookie/source-IP affinity).

There is no shared session store today; introducing horizontal scaling without
affinity is a code change, not a config change.

## 7. Observability

- Structured JSON logs via Pino to stdout (`LOG_LEVEL=info` in prod). Ship with
  your standard stdout collector. Auth headers and cookies are redacted.
- Each request gets a correlation `reqId`.
- No metrics endpoint yet — if you scrape Prometheus, that's a follow-up.

## 8. Graceful shutdown

`enableShutdownHooks()` is on: on `SIGTERM` the app drains in-flight requests and
closes transports. Give the orchestrator a `terminationGracePeriodSeconds` of
~15–30s.

## 9. Pre-deploy checklist

- [ ] `.env.production` populated; `MCP_CLIENT_API_KEY` set to a strong value.
- [ ] `BACKEND_BASE_URL` reachable from the MCP host/pod.
- [ ] TLS terminated upstream; `TRUST_PROXY=true`.
- [ ] Liveness `/healthz` + readiness `/healthz/ready` wired into the orchestrator.
- [ ] Single replica **or** sticky sessions configured.
- [ ] Image scanned; runs as non-root (already enforced in the Dockerfile).
- [ ] Smoke test (below) passes against the deployed URL.

## 10. Smoke test

```bash
# Liveness
curl -fsS https://<host>/healthz                  # {"status":"ok"}

# Readiness (200 only if backend reachable)
curl -fsS https://<host>/healthz/ready

# MCP handshake — without the key this must return 401
curl -i -X POST https://<host>/mcp \
  -H 'content-type: application/json' \
  -H 'x-api-key: <MCP_CLIENT_API_KEY>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
