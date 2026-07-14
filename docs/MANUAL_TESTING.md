# Manual Testing Guide

How to exercise the TechTrax MCP server by hand — with **Postman**, **curl**, or the
**MCP Inspector** — after the change that lets AI models pass `tenantId` as a **tool
argument** (instead of only the `x-tenant-id` header).

---

## 1. What you need to know first

| Fact | Value / implication |
| --- | --- |
| **Endpoint** | `POST http://localhost:3100/mcp` |
| **Transport** | Streamable HTTP, **stateful** (`statelessMode: false`) |
| **Responses** | **SSE** (`text/event-stream`) by default — `enableJsonResponse: false` |
| **Session** | `initialize` returns an `Mcp-Session-Id` header you must echo on every later call |
| **Inbound auth** | `x-api-key` only if `MCP_CLIENT_API_KEY` is set in `.env` (empty in dev → omit) |
| **Tenant** | Now a tool **argument** `tenantId` (24-char hex ObjectId). `x-tenant-id` header still works as a fallback |
| **Backend** | Real tool data needs the Express backend up at `BACKEND_BASE_URL` (default `http://localhost:5000`) |

### Tenant resolution precedence
The server resolves the tenant in this order (`resolveTenantId`):

1. **`tenantId` tool argument** ← what AI models now send
2. `request.user` (future auth)
3. `x-tenant-id` HTTP header (legacy, still supported)

If none are present, tools return `isError: true` with *"Tenant context is missing…"*.

---

## 2. Start the server

```bash
cp .env.example .env      # first time only
npm install               # first time only
npm run start:dev
```

You should see: `techtrax-mcp v1.0.0 listening on http://0.0.0.0:3100/mcp`.

> Tool calls proxy to the backend. If the backend isn't running you'll still see
> tenant **validation/resolution** behavior; you'll just get a readable gateway
> error instead of real data.

---

## 3. Required headers on every request

```
Content-Type: application/json
Accept: application/json, text/event-stream
```

The `Accept` header **must list both** media types — the transport returns `406`
otherwise. Add `x-api-key: <key>` only if you configured `MCP_CLIENT_API_KEY`.

---

## 4. Testing with Postman

### 4.0 Fast path — import the ready-made collection

A pre-built collection lives at
[`docs/techtrax-mcp.postman_collection.json`](./techtrax-mcp.postman_collection.json).
It has every request below already wired up, including a Tests script on
`initialize` that auto-captures the session id.

1. **Import** it: Postman → **Import** → **File** → pick the JSON above.
2. Open the collection → **Variables** tab and set:
   - `baseUrl` → `http://localhost:3100`
   - `tenantId` → a real 24-char hex clinic ObjectId
   - `apiKey` → leave empty in dev (set only if `MCP_CLIENT_API_KEY` is configured)
   - `sessionId` → leave empty; it's filled in automatically by request **1**
3. **Run the requests top to bottom** (they share `{{sessionId}}`):
   1. `1. initialize` — opens the session and stores `Mcp-Session-Id` → `{{sessionId}}`
   2. `2. notifications/initialized` — completes the handshake
   3. `3. tools/list` — confirm each tool now has a `tenantId` param
   4. `4a / 4b / 4c` — `tools/call` happy paths (`tenantId` in `arguments`)
   5. `5a / 5b` — negatives: missing tenant, malformed tenant
   6. `6. Legacy` — tenant via the `x-tenant-id` header (back-compat)

   You can also use the **Collection Runner** (collection → **Run**) to fire all of
   them in order in one click — the session id flows from request 1 to the rest.

> Re-run `1. initialize` any time you need a fresh session (e.g. after restarting
> the server) — it refreshes `{{sessionId}}` for every following request.

The rest of this section (4.1–4.4) documents the same requests by hand, in case you
prefer to build them yourself or use another client.

### 4.1 `initialize`

`POST http://localhost:3100/mcp`

Body (raw / JSON):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": { "name": "postman", "version": "1.0.0" }
  }
}
```

The response body is SSE text (a `data: {...}` line). In the request's **Tests** tab,
capture the session id automatically:

```javascript
const sid = pm.response.headers.get("mcp-session-id");
if (sid) pm.collectionVariables.set("sessionId", sid);
```

### 4.2 `notifications/initialized`

Same URL + headers, **plus** `Mcp-Session-Id: {{sessionId}}`. Body (a notification —
note there is no `id`):

```json
{ "jsonrpc": "2.0", "method": "notifications/initialized" }
```

Expect `202 Accepted` with an empty body.

### 4.3 `tools/list` (optional — confirm the new param)

Headers include `Mcp-Session-Id: {{sessionId}}`. Body:

```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }
```

In each tool's `inputSchema.properties` you should now see a **`tenantId`** field
(24-char hex, with a description).

### 4.4 `tools/call` — pass `tenantId` in `arguments`

Headers include `Mcp-Session-Id: {{sessionId}}`. Body:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "tenant_info.list_doctors",
    "arguments": {
      "tenantId": "6650f1a2b3c4d5e6f7a8b9c0",
      "specialty": "cardiology"
    }
  }
}
```

---

## 5. What to verify (test matrix)

| Scenario | `arguments` / headers | Expected result |
| --- | --- | --- |
| **Happy path** | valid 24-hex `tenantId` | Server forwards `x-tenant-id` to backend; real data (backend up) |
| **Missing tenant** | no `tenantId`, no `x-tenant-id` header | `isError: true`, *"Tenant context is missing…"* |
| **Malformed tenant** | `"tenantId": "abc"` | JSON-RPC validation error: *"tenantId must be a 24-character hex id (MongoDB ObjectId)"* |
| **Precedence** | `tenantId` arg **and** a different `x-tenant-id` header | The **argument wins** |
| **Legacy fallback** | no `tenantId` arg, but `x-tenant-id: <hex>` header | Still works — resolves from the header |

Tools to try:
- `tenant_info.get_clinic_profile` — `{ "tenantId": "<hex>" }`
- `tenant_info.list_doctors` — `{ "tenantId": "<hex>", "specialty": "cardiology" }`
- `statistics.get_appointment_summary` — `{ "tenantId": "<hex>", "from": "2026-07-01", "to": "2026-07-07" }`
- `appointment.find_patient` — `{ "tenantId": "<hex>", "query": "john" }`

---

## 6. Testing with curl

```bash
# 1. initialize — capture the session id from the response headers (-i shows them)
curl -i -X POST http://localhost:3100/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{
    "jsonrpc": "2.0", "id": 1, "method": "initialize",
    "params": {
      "protocolVersion": "2025-06-18",
      "capabilities": {},
      "clientInfo": { "name": "curl", "version": "1.0.0" }
    }
  }'
# → copy the "Mcp-Session-Id: <uuid>" response header into SID below
SID='<paste-session-id>'

# 2. notifications/initialized
curl -i -X POST http://localhost:3100/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "Mcp-Session-Id: $SID" \
  -d '{ "jsonrpc": "2.0", "method": "notifications/initialized" }'

# 3. tools/call with tenantId in arguments
curl -i -X POST http://localhost:3100/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "Mcp-Session-Id: $SID" \
  -d '{
    "jsonrpc": "2.0", "id": 3, "method": "tools/call",
    "params": {
      "name": "tenant_info.list_doctors",
      "arguments": { "tenantId": "6650f1a2b3c4d5e6f7a8b9c0", "specialty": "cardiology" }
    }
  }'
```

> On Windows PowerShell, prefer the `curl.exe` binary (not the `curl` alias) or use
> Postman — PowerShell quoting mangles JSON bodies.

---

## 7. Easier: MCP Inspector

The Inspector handles `initialize`/session automatically and gives you a form per
tool:

```bash
npx @modelcontextprotocol/inspector
```

Connect to `http://localhost:3100/mcp` (transport: **Streamable HTTP**), add
`x-api-key` if configured, then pick a tool and fill in `tenantId` + other args.

---

## 8. Tip: plain JSON instead of SSE (dev only)

Reading SSE bodies in Postman is clunky. For local testing you can switch the
transport to JSON responses in `src/app.module.ts`:

```ts
streamableHttp: {
  enableJsonResponse: true,   // was false
  sessionIdGenerator: () => randomUUID(),
  statelessMode: false,
},
```

Restart the server; `initialize` and `tools/call` now return normal JSON bodies (you
still pass the `Mcp-Session-Id` header). **Revert before committing** — it's only a
dev convenience.

---

## 9. Automated tests

The resolution logic and the `tenantId` parameter are covered by unit tests:

```bash
npm test
```

See `src/common/mcp/tenant.util.spec.ts` (precedence, trimming, ObjectId validation)
and the per-namespace `*.tools.spec.ts` files.
