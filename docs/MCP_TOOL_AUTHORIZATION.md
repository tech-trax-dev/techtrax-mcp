# MCP Tool Authorization

Every MCP tool call is scoped by two things your **client** supplies (not the AI model):

| Where | Name | Purpose | Example |
| --- | --- | --- | --- |
| Header | `x-tenant-id` | Which clinic to act on (24-char hex id) | `x-tenant-id: 6935b6ea…` |
| `tools/call` argument | `actorRole` | Who the AI is acting for (per call) | `"actorRole": "patient"` |

> `x-api-key` still authenticates the client itself (unchanged), and `x-tenant-id` still scopes the tenant (unchanged). `tenantId` is still a per-call tool argument (unchanged).

## ⚠️ `actorRole` is a per-call tool argument (read this first)

The role travels in the **`arguments` of each `tools/call`** — exactly like `tenantId` — not in `initialize` params and not in a header. Allowed values: `patient` | `doctor` | `receptionist` | `admin`.

- ✅ Include `actorRole` in the `arguments` of **every** `tools/call`.
- Omitted or unrecognised → `patient` (the least-privilege `DEFAULT_ACTOR_ROLE`), so a **staff-facing client MUST inject an explicit staff role** (`receptionist` / `doctor` / `admin`) into each call to unlock staff tools.

```jsonc
{ "method": "tools/call",
  "params": { "name": "statistics.get_appointment_summary",
              "arguments": { "tenantId": "6935b6ea…", "actorRole": "receptionist",
                             "from": "2026-07-01", "to": "2026-07-07" } } }
```

Enforcement is **per-call**: a `@RequireCapability(...)` wrapper around each tool handler reads the call's `actorRole` and checks it against the tool's capability. The role is only known at call time — there is no session-wide role — so the same client can make calls as different roles on different tools (a trusted client normally pins one role per session; see below).

## Set a fixed role in a patient-facing client

Because `actorRole` is a tool argument produced by the model, the **trusted client should inject it into each call** (the same way it injects `tenantId`) rather than letting the model choose. A patient-facing client should **hard-pin `actorRole: 'patient'`** on every call so the model cannot self-elevate (e.g. slip in `actorRole: "admin"`). `actorRole` is authorization *scoping* for a trusted client, **not** authentication — the real gate is `x-api-key`.

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
| CRM: create / assign a lead | `crm.create_lead` / `crm.assign_lead` (`lead:write`) | ❌ | ✅ |

The role is only known at call time, so enforcement is **per-call** against each tool's capability:

- **`tools/list` is NOT filtered.** Every tool is always listed for every caller (the role isn't known until a tool is called). A `patient` **sees** `statistics.*`, `crm.*`, `find_patient`, and `list_appointments` / `get_appointment` in the catalog — but calling them is rejected.
- **`tools/call` is rejected** when the call's `actorRole` lacks the tool's capability (`Not authorized: the '<role>' role cannot perform '<capability>'…`), and the backend is never called.

To discover which role can actually call which tool (since the list isn't filtered), use `GET /tool-access` — see below.

## Discovering access: `GET /tool-access`

Because `tools/list` is not role-filtered, a plain HTTP endpoint (**not** an MCP tool) exposes the role → tool policy:

- **`GET /tool-access`** → the full matrix:
  ```jsonc
  { "roles": ["patient", "doctor", "receptionist", "admin"],
    "capabilitiesByRole": { "patient": ["clinic:read", "slots:read", "appointment:write"], "…": [] },
    "tools": [ { "name": "statistics.get_appointment_summary", "capability": "statistics:read",
                 "allowedRoles": ["doctor", "receptionist", "admin"] } ],
    "toolsByRole": { "patient": ["…"], "receptionist": ["…"] } }
  ```
- **`GET /tool-access?role=patient`** → just that role's callable tools:
  ```jsonc
  { "role": "patient",
    "capabilities": ["clinic:read", "slots:read", "appointment:write"],
    "tools": [ { "name": "appointment.book", "capability": "appointment:write" } ] }
  ```
  An unknown `role` returns HTTP `400`.

Implementation lives in `src/tool-access/` (`ToolAccessController` + `ToolAccessService`).

## How to use it (per call)

Inject `actorRole` into each `tools/call`'s `arguments` based on who is talking to the AI:

- **Patient chatbot** → hard-pin `"actorRole": "patient"` on every call (or omit it)
- **Front-desk / staff assistant** → `"actorRole": "receptionist"` (or `doctor` / `admin`)

Behavior when `actorRole` is missing or wrong (fail-**closed** to `patient`):

- **Omitted** → `patient` (the `DEFAULT_ACTOR_ROLE` constant in `src/common/mcp/authorization.util.ts`). Least privilege, so a **staff-facing client MUST inject an explicit staff role into each call** to reach staff tools.
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
