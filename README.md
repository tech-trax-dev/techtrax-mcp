# TechTrax MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
TechTrax backend capabilities (tenant info, appointments, statistics, health) as
MCP **tools** to AI clients. Built on [NestJS](https://nestjs.com) +
[`@rekog/mcp-nest`](https://www.npmjs.com/package/@rekog/mcp-nest).

```
┌────────────┐   MCP / streamable-HTTP    ┌──────────────┐   HTTP + x-internal-api-key   ┌────────────────────┐
│ AI client  │ ─────────────────────────▶ │  MCP server  │ ────────────────────────────▶ │ TechTrax Express   │
│ (Claude…)  │   POST /mcp  x-api-key     │  (this repo) │   /tenant, /appointments…     │ backend API        │
└────────────┘                            └──────────────┘                               └────────────────────┘
```

- **Transport:** streamable HTTP only, stateful sessions. Endpoint: `POST /mcp`.
- **Inbound auth:** `x-api-key` header validated against `MCP_CLIENT_API_KEY`
  (required in production).
- **Outbound auth:** every backend call carries `x-internal-api-key`
  (`BACKEND_API_KEY`).
- **Probes:** `GET /healthz` (liveness), `GET /healthz/ready` (readiness — checks
  the backend).

## Quick start (local)

```bash
nvm use            # Node 24 (see .nvmrc)
npm ci
cp .env.example .env   # adjust BACKEND_BASE_URL / BACKEND_API_KEY
npm run start:dev
```

Server logs `…listening on http://0.0.0.0:3100/mcp`. Explore it with the MCP
Inspector:

```bash
npx @modelcontextprotocol/inspector
# connect to http://localhost:3100/mcp (transport: Streamable HTTP)
```

## Configuration

All config is via environment variables, validated at boot
([`src/config/env.validation.ts`](src/config/env.validation.ts)). The process
**refuses to start** on invalid/missing values.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |
| `HOST` | no | `0.0.0.0` | Bind address (keep `0.0.0.0` in containers) |
| `PORT` | no | `3100` | HTTP listen port |
| `BACKEND_BASE_URL` | **yes** | — | TechTrax Express base URL |
| `BACKEND_API_KEY` | **yes** | — | Internal secret sent as `x-internal-api-key` |
| `BACKEND_TIMEOUT_MS` | no | `15000` | Outbound request timeout |
| `MCP_SERVER_NAME` | no | `techtrax-mcp` | Server name advertised to clients |
| `MCP_SERVER_VERSION` | no | `1.0.0` | Server version advertised to clients |
| `MCP_CLIENT_API_KEY` | **prod only** | — | Inbound `x-api-key`; required when `NODE_ENV=production` |
| `CORS_ALLOWED_ORIGINS` | no | — | Comma-separated browser origins; empty = CORS off |
| `TRUST_PROXY` | no | `false` | Set `true` behind a proxy/LB/ingress |
| `LOG_LEVEL` | no | `info` | `fatal`…`trace` |

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run start:dev` | Watch mode (pretty logs) |
| `npm run build` | Compile to `dist/` |
| `npm run start:prod` | Run compiled build (`node dist/main`) |
| `npm test` | Unit tests |
| `npm run lint` / `lint:ci` | Lint (autofix / check-only) |

## Tools

Each namespace is a self-contained module under [`src/tools/`](src/tools/):

| Namespace | Example tools |
| --- | --- |
| `health` | `health.ping`, `health.backend` |
| `tenant-info` | tenant lookup |
| `appointment` | appointment queries |
| `statistics` | reporting/statistics |

Adding a namespace = new folder + module + one import line in
[`tools.module.ts`](src/tools/tools.module.ts). No infra changes.

## Deployment

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the DevOps runbook (Docker, compose,
k8s probes, scaling, secrets).
