# MCP Architecture & Authorization — What We Built and How to Extend It

This is the "big picture" for the TechTrax MCP surface: the two systems we put in
place, and the exact steps to change capabilities or add a tool **without
breaking them**.

- Adding the plumbing of a tool → [ADDING_A_TOOL.md](./ADDING_A_TOOL.md)
- Using the roles/headers as a client → [MCP_TOOL_AUTHORIZATION.md](./MCP_TOOL_AUTHORIZATION.md)
- This doc → why it's shaped this way + the rules to follow when extending it.

---

## 1. What we built

### A. Single source of truth (no reimplemented queries)

The MCP surface is **two layers**:

```
techtrax-mcp (this repo, NestJS)      techtrax-backend (Express)
  @Tool method  ──HTTP──►  /api/v1/mcp/*  (src/modules/mcp)  ──►  cms.interface / crm.interface  ──►  the SAME service the app/frontend uses
```

Rules that make this work:

1. **A tool is a thin adapter.** It validates input, resolves tenant, makes **one**
   backend call, and shapes the result. No domain logic in the tool.
2. **The backend MCP module (`src/modules/mcp`) holds no business logic either.**
   It maps a flat DTO and reaches business logic **only through a module
   interface** (`cms.interface.js`, `crm.interface.js`).
3. **An MCP endpoint must call the exact service the app's real endpoint calls.**
   e.g. `list_doctors` → `getReceptionistDoctorList` (the same service behind
   `GET /doctors/doctor-list`). Never re-write the query in the MCP layer —
   reimplementations drift and silently break (that's what caused the earlier
   `list_doctors` / `find_patient` empty-result bugs).

> **Why:** when the app changes how doctors are listed, MCP inherits it for free.
> One query, one place.

### B. Role-based authorization (with `tools/list` filtering)

Every tool declares a **capability**; the caller has a **role** (from the
`x-actor-role` header). A single guard enforces it in **both** places the MCP
framework checks guards:

- **`tools/list`** — a session only *sees* tools its role can use.
- **`tools/call`** — calling a disallowed tool is rejected; the backend is never hit.

Key files:

| File | What it holds |
| --- | --- |
| [`common/mcp/authorization.util.ts`](../src/common/mcp/authorization.util.ts) | Roles, capabilities, the `ROLE_CAPABILITIES` policy map, `DEFAULT_ACTOR_ROLE`, `resolveActorRole()` |
| [`common/mcp/tool-authorization.guard.ts`](../src/common/mcp/tool-authorization.guard.ts) | `ToolCapabilityGuard` + the `@RequireCapability(cap)` decorator |

Security invariants (don't violate these):

- **Role comes from the `x-actor-role` transport header, never a tool argument.**
  Tool args are produced by the AI model, so a role arg could be self-elevated.
- **Default is `admin`** (`DEFAULT_ACTOR_ROLE`) — full access / fail-open.
  An absent or unknown role value resolves to `admin`, so a patient-facing
  client MUST send an explicit `x-actor-role: patient` to restrict it.
- **Stateful transport reads the header at `initialize`**, so the client sets
  `x-actor-role` on the connection (a session = one actor), not per call.

---

## 2. How to change capabilities

Everything is one map. Edit
[`ROLE_CAPABILITIES`](../src/common/mcp/authorization.util.ts):

```ts
export const ROLE_CAPABILITIES: Record<ActorRole, readonly Capability[]> = {
  patient: ['clinic:read', 'slots:read', 'appointment:write'],
  doctor: STAFF,
  receptionist: STAFF,
  admin: CAPABILITIES,
};
```

- **Grant/revoke a capability for a role** → add/remove it from that role's array.
  The change instantly affects both `tools/list` and `tools/call` for every tool
  tagged with that capability.
- **Add a brand-new capability** → add the string to the `CAPABILITIES` array
  (and its `Capability` type updates automatically), add it to whichever roles
  should have it, then tag the relevant tools with `@RequireCapability('new:cap')`.
- **Change the fallback role** → edit the `DEFAULT_ACTOR_ROLE` constant.

Update the matrix in [MCP_TOOL_AUTHORIZATION.md](./MCP_TOOL_AUTHORIZATION.md) when
you change the policy, and add/adjust a case in
`authorization.util.spec.ts`.

---

## 3. Adding a new tool — the full checklist (follow this system)

A new tool is usually **two repos**. Do them in this order.

### Step 1 — Backend: expose the real service through the interface

In `techtrax-backend`:

1. Find the service the app already uses for this action (trace the frontend/app
   endpoint → controller → service). **Reuse it — do not re-query.**
2. Add a method to the owning module's interface (`src/modules/<mod>/<mod>.interface.js`)
   that delegates to that service. The MCP module may call **only** the interface,
   never the service/repo/model directly.
3. Add the MCP endpoint under `src/modules/mcp/` (route + controller + a thin
   adaptation service that maps to a flat DTO). It's guarded by `mcpInternalAuth`
   (internal key + `x-tenant-id`), so there is **no `req.user`** — only
   `req.tenantId`. If the underlying service needs a user, synthesize a
   system actor from the tenant (see `mcp/services/appointments.service.js`
   `resolveActor` for the pattern).
4. Keep the external contract stable; verify against real data.

### Step 2 — MCP: add the tool (see [ADDING_A_TOOL.md](./ADDING_A_TOOL.md) for full detail)

1. Output Zod schema in `src/contracts/<name>.schemas.ts` (mirror the backend DTO;
   `.nullable()` anything optional).
2. `@Tool({...})` handler in `src/tools/<name>/<name>.tools.ts`: model-grade
   `description`, `parameters` (with `tenantIdParam`), `outputSchema`,
   `annotations`. Resolve tenant with `resolveTenantId(request, args)`; one
   `BackendHttpService` call forwarding `x-tenant-id`.
3. **Authorization (this system):** add
   `@RequireCapability('<capability>')` directly above the method (below `@Tool`).
   Pick or add the capability in `authorization.util.ts` and make sure the roles
   that should use it have it in `ROLE_CAPABILITIES`.
   ```ts
   @Tool({ name: 'crm.assign_lead', /* … */ })
   @RequireCapability('lead:write')
   async assignLead(args, _ctx, request) { /* … */ }
   ```
   Without `@RequireCapability`, the tool is **unrestricted** (visible/callable by
   every role, including `patient`) — so always tag it unless that's intended.
4. (New namespace only) create `<name>.module.ts` with
   `McpModule.forFeature([XxxTools], MCP_SERVER_NAME)` and add it to
   `src/tools/tools.module.ts`.

### Step 3 — Tests & docs

- Tool unit test: success + backend-error + missing-tenant (mock the backend).
- If you added a capability or changed the policy: update the matrix in
  `MCP_TOOL_AUTHORIZATION.md` and add a `roleCan(...)` / guard case in
  `authorization.util.spec.ts`.
- `npm run build`, `npm run lint`, `npm test` all green.

### Decide the capability by "who should use it"

| The tool… | Capability | Typically allowed to |
| --- | --- | --- |
| Reads public clinic/doctor info | `clinic:read` | everyone incl. patient |
| Reads a doctor's slots | `slots:read` | everyone incl. patient |
| Reads/searches other people's records (patients, all appointments) | `patient:read` / `appointment:read` | staff only |
| Mutates the caller's own appointment | `appointment:write` | patient + staff |
| Reads tenant-wide analytics | `statistics:read` | staff only |
| CRM/lead/team operations | a `lead:*` / `crm:*` capability (staff only) | staff only |

If a tool exposes **other people's data or tenant-wide numbers**, it's staff-only.
If it's the caller's own self-service action, patients may have it — but remember
the MCP layer knows the *role*, not *which* person, so the client must scope
ids to the signed-in user.

---

## 4. Quick reference — where things live

| Concern | File |
| --- | --- |
| Role/capability policy | `src/common/mcp/authorization.util.ts` |
| The guard + `@RequireCapability` | `src/common/mcp/tool-authorization.guard.ts` |
| Tenant resolution | `src/common/mcp/tenant.util.ts` |
| Tool result helpers | `src/common/mcp/tool-response.util.ts` |
| Backend HTTP client | `src/common/backend/backend-http.service.ts` |
| Backend MCP module | `techtrax-backend/src/modules/mcp/` |
| Module interfaces (the seam) | `techtrax-backend/src/modules/<mod>/<mod>.interface.js` |
