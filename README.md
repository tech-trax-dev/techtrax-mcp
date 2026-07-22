<p align="center">
  <img src="docs/assets/mcp-wordmark.png" alt="TechTrax MCP Server" width="360" />
</p>

# TechTrax MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
TechTrax backend capabilities (tenant info, appointments, statistics, health) as
MCP **tools** to AI clients. Built on [NestJS](https://nestjs.com) +
[`@rekog/mcp-nest`](https://www.npmjs.com/package/@rekog/mcp-nest).

```mermaid
flowchart LR
    client["AI client<br/>(Claude, etc.)"]
    mcp["MCP server<br/>(this repo)"]
    backend["TechTrax Express<br/>backend API"]

    client -->|"POST /mcp<br/>x-api-key"| mcp
    mcp -->|"HTTP + x-internal-api-key<br/>/tenant, /appointments, …"| backend
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

## Authorization (per-call role)

Two request headers scope every call (both set by the trusted client, not the AI model):

- **`x-tenant-id`** — the clinic to act on.
- **`x-actor-role`** — who the AI is acting for: `patient`, `doctor`, `receptionist`, or `admin`. Absent or unrecognised → `admin` (full access), the `DEFAULT_ACTOR_ROLE` in [`authorization.util.ts`](src/common/mcp/authorization.util.ts), so a **patient-facing client MUST send `x-actor-role: patient`** to restrict it.

> ⚠️ **Set `x-actor-role` on the connection/`initialize` request**, not per `tools/call`. In stateful Streamable HTTP the framework reads headers once at session init, so a header on an individual call is ignored (the session's init role applies). A session = one actor. See [docs/MCP_TOOL_AUTHORIZATION.md](docs/MCP_TOOL_AUTHORIZATION.md).

The role is **never** a tool argument — reading it from the transport prevents the model from self-elevating. Policy lives in [`src/common/mcp/authorization.util.ts`](src/common/mcp/authorization.util.ts) (`ROLE_CAPABILITIES`):

| Capability | Tools | patient | doctor / receptionist / admin |
| --- | --- | :---: | :---: |
| `clinic:read` | `tenant_info.*` (clinic, doctor directory, specialties) | ✅ | ✅ |
| `slots:read` | `appointment.get_available_slots` | ✅ | ✅ |
| `appointment:write` | `appointment.book` / `reschedule` / `cancel` | ✅ | ✅ |
| `patient:read` | `appointment.find_patient` | ❌ | ✅ |
| `appointment:read` | `appointment.list_appointments` / `get_appointment` | ❌ | ✅ |
| `statistics:read` | `statistics.*` | ❌ | ✅ |
| `lead:read` | `crm.list_teams` / `crm.get_team` | ❌ | ✅ |
| `lead:write` | `crm.assign_lead` | ❌ | ✅ |

Enforcement is automatic in both directions: tools a role can't use are **omitted from `tools/list`** for that session, and calling one anyway is **rejected** (no backend call). Patients get the self-service set — browse the clinic/doctors/specialties, check slots, and manage their own appointments (book/reschedule/cancel). They cannot search the patient directory, list every appointment in the tenant, or view analytics. Edit `ROLE_CAPABILITIES` in [`authorization.util.ts`](src/common/mcp/authorization.util.ts) (and each tool's `@RequireCapability(...)`) to adjust.

> ⚠️ **Self-scoping:** the header identifies the caller as a *patient*, not *which* patient, so the MCP layer cannot enforce "your own record only". A patient-facing client MUST constrain `patientId` (book) and `appointmentId` (reschedule/cancel) to the signed-in patient.

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

👉 **Adding or extending a tool?** Follow the step-by-step guide with conventions,
a full worked example, and a pre-merge checklist:
**[docs/ADDING_A_TOOL.md](docs/ADDING_A_TOOL.md)**.

👉 **Assigning CRM leads with the AI?** The `crm.*` tools + the three assignment
methods (specific person / team lead / round-robin) are documented in
**[docs/AI-LEAD-ASSIGNMENT.md](docs/AI-LEAD-ASSIGNMENT.md)**.

## Testing

Run the unit suite with `npm test`.

To exercise the server by hand (Postman, curl, or the MCP Inspector), follow
**[docs/MANUAL_TESTING.md](docs/MANUAL_TESTING.md)** — it walks through the session
handshake and passing `tenantId` as a tool argument.

Ready-to-import Postman collection:
**[docs/techtrax-mcp.postman_collection.json](docs/techtrax-mcp.postman_collection.json)**
(auto-captures the MCP session id; set `baseUrl` / `tenantId` in the collection
variables).

Integrating an AI agent runtime with the server? See
**[docs/AI_AGENT_INTEGRATION_GUIDE.md](docs/AI_AGENT_INTEGRATION_GUIDE.md)**.

📌 **Existing integrator?** The tenant is now passed as a **`tenantId` tool
argument** (the `x-tenant-id` header still works). One-page change notice:
**[docs/TENANT_ID_MIGRATION.md](docs/TENANT_ID_MIGRATION.md)**.

## Deployment

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the DevOps runbook (Docker, compose,
k8s probes, scaling, secrets).
