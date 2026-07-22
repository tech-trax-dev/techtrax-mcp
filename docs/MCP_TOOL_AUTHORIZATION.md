# MCP Tool Authorization

Every MCP tool call is scoped by two things your **client** supplies (not the AI model):

| Where | Name | Purpose | Example |
| --- | --- | --- | --- |
| Header | `x-tenant-id` | Which clinic to act on (24-char hex id) | `x-tenant-id: 6935b6ea…` |
| `initialize` params | `actorRole` | Who the AI is acting for (whole session) | `"actorRole": "patient"` |

> `x-api-key` still authenticates the client itself (unchanged), and `x-tenant-id` still scopes the tenant (unchanged). `tenantId` is still a per-call tool argument (unchanged).

## ⚠️ `actorRole` is set once in the `initialize` params (read this first)

The role travels in the **`params` of the JSON-RPC `initialize` request**, and it applies to the **whole session** — not per call, and not in a header. Allowed values: `patient` | `doctor` | `receptionist` | `admin`.

- ✅ Send `actorRole` in `initialize` `params`, once, when the session opens.
- Omitted or unrecognised → `patient` (the least-privilege `DEFAULT_ACTOR_ROLE`), so a **staff-facing client MUST send an explicit staff role** (`receptionist` / `doctor` / `admin`) at init to unlock staff tools.

```jsonc
{ "jsonrpc": "2.0", "id": 1, "method": "initialize",
  "params": { "protocolVersion": "2025-06-18", "capabilities": {},
              "clientInfo": { "name": "…", "version": "…" },
              "actorRole": "receptionist" } }
```

A guard (`ActorRoleCaptureGuard`) captures `params.actorRole` at init; in stateful Streamable HTTP mcp-nest reuses that captured request for the whole session, so the role applies to every later `tools/list` and `tools/call`. **A session = one actor.** To act as a different role, open a **new session** with a different `actorRole`.

## Set a fixed role in a patient-facing client

The AI model never sees or influences the role — it's fixed at `initialize` by your client, before the model runs. A patient-facing client can simply **omit `actorRole` or pass `patient`** at init; because the role is not a tool argument, the model cannot self-elevate (`actorRole: "admin"`) mid-session.

## Roles → what they can do

| Action | Tools | `patient` | `doctor` / `receptionist` / `admin` |
| --- | --- | :---: | :---: |
| Clinic info, doctor list, specialties, availability | `tenant_info.*` | ✅ | ✅ |
| Available slots for a doctor | `appointment.get_available_slots` | ✅ | ✅ |
| Book / reschedule / cancel an appointment | `appointment.book` / `reschedule` / `cancel` | ✅ | ✅ |
| Search the patient directory | `appointment.find_patient` | ❌ | ✅ |
| List / fetch any appointment in the clinic | `appointment.list_appointments` / `get_appointment` | ❌ | ✅ |
| Tenant analytics | `statistics.*` | ❌ | ✅ |
| CRM: list teams + members | `crm.list_teams` / `crm.get_team` (`lead:read`) | ❌ | ✅ |
| CRM: assign a lead | `crm.assign_lead` (`lead:write`) | ❌ | ✅ |

The session role is known from `initialize`, so both list and call are enforced by the same per-tool capability + session role:

- **`tools/list` is filtered.** A `patient` session's catalog **excludes** `statistics.*`, `crm.*`, `find_patient`, and `list_appointments` / `get_appointment` — the session only sees the tools its role can use.
- **`tools/call` is rejected** for a tool the session role lacks (`Access denied: insufficient permissions for tool '<name>'`), and the backend is never called.

A disallowed tool is both hidden from the list and rejected if called anyway.

## How to use it (per session)

Set `actorRole` in the **`initialize` `params`** based on who is talking to the AI, once when the session opens:

- **Patient chatbot** → `"actorRole": "patient"` (or omit it)
- **Front-desk / staff assistant** → `"actorRole": "receptionist"` (or `doctor` / `admin`)

Behavior when `actorRole` is missing or wrong (fail-**closed** to `patient`):

- **Omitted** → `patient` (the `DEFAULT_ACTOR_ROLE` constant in `src/common/mcp/authorization.util.ts`). Least privilege, so a **staff-facing client MUST send an explicit staff role at init** to reach staff tools.
- **Unrecognised value** → also `patient`.

> ⚠️ This is fail-**closed**: an unidentified caller gets only the patient tool surface. Change the fallback by editing `DEFAULT_ACTOR_ROLE`.

## ⚠️ Patient self-scoping (important)

The role says the caller is *a patient*, not *which* patient. The MCP layer **cannot** guarantee a patient only touches their own records. When running a patient session, your client MUST:

- pass the signed-in patient's own `patientId` to `appointment.book`, and
- pass only the patient's own `appointmentId` to `appointment.reschedule` / `cancel`.

Do not let a patient session call these with someone else's id.

## Changing the policy

Edit the one map in [`src/common/mcp/authorization.util.ts`](../src/common/mcp/authorization.util.ts):

```ts
export const ROLE_CAPABILITIES = {
  patient: ['clinic:read', 'slots:read', 'appointment:write'],
  doctor: STAFF,
  receptionist: STAFF,
  admin: CAPABILITIES,
};
```

Add/remove a capability for a role and the change applies to every tool tagged with it.
