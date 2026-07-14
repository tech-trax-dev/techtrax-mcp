# Change notice — pass `tenantId` as a tool argument

**Audience:** anyone whose agent/client calls the TechTrax MCP server.
**TL;DR:** the tenant can now be sent as a **`tenantId` tool argument** on each
`tools/call`, instead of the `x-tenant-id` HTTP header. The header still works, so
**nothing breaks** — but new integrations should use the argument.

---

## What changed

| | Before | Now |
| --- | --- | --- |
| How the tenant is sent | `x-tenant-id` **HTTP header** | **`tenantId` argument** in each tool call (header still accepted) |
| Who supplies it | The MCP client, per request header | The AI model / agent runtime, in the tool `arguments` |
| Validation | Presence only | 24-char hex Mongo ObjectId (Zod-validated) |

**Resolution precedence (no conflict):** `tenantId` argument → `request.user` →
`x-tenant-id` header. **If both an argument and a header are present, the argument
wins.**

## Why

AI models emit **tool-call arguments**, not HTTP headers. Making `tenantId` a tool
argument lets the model/runtime carry the tenant as data — the same way `patientId`
already works — so a single `tools/call` fully describes the request.

## How to use the new way

Add `tenantId` (a 24-char hex ObjectId) to every tool call's `arguments`:

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

**Before** (header — still works):

```
POST /mcp
x-tenant-id: 6650f1a2b3c4d5e6f7a8b9c0
{ "method": "tools/call", "params": { "name": "tenant_info.list_doctors",
  "arguments": { "specialty": "cardiology" } } }
```

**After** (argument — recommended): no `x-tenant-id` header; `tenantId` goes in
`arguments` as shown above.

> **Best practice:** have your agent runtime **inject `tenantId` into every tool
> call's `arguments`** from session context (don't rely on the model to remember or
> invent it). See the client pseudocode in
> [AI_AGENT_INTEGRATION_GUIDE.md §3](./AI_AGENT_INTEGRATION_GUIDE.md#3-the-first-call-initialize-handshake).

## Do I have to change anything?

**No — the `x-tenant-id` header is still honored.** Existing header-based clients
keep working unchanged. Migrate when convenient; new clients should use the argument.

## Common errors

| Message | Cause | Fix |
| --- | --- | --- |
| `Tenant context is missing…` | No `tenantId` argument **and** no `x-tenant-id` header | Add `tenantId` to `arguments` |
| `tenantId must be a 24-character hex id (MongoDB ObjectId)` | Malformed value (name/slug/short id) | Pass a valid 24-char hex ObjectId |

## More

- Full integration guide: [AI_AGENT_INTEGRATION_GUIDE.md](./AI_AGENT_INTEGRATION_GUIDE.md)
- Hands-on testing (Postman/curl/Inspector): [MANUAL_TESTING.md](./MANUAL_TESTING.md)
