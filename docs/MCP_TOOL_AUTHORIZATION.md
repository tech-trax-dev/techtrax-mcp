# MCP Tool Authorization

Every MCP tool call is scoped by **two request headers your client sets** (not the AI model):

| Header | Purpose | Example |
| --- | --- | --- |
| `x-tenant-id` | Which clinic to act on (24-char hex id) | `x-tenant-id: 6935b6ea…` |
| `x-actor-role` | Who the AI is acting for | `x-actor-role: patient` |

> `x-api-key` still authenticates the client itself (unchanged).

## ⚠️ Where to put `x-actor-role` (read this first)

The server runs **stateful Streamable HTTP**, and the MCP framework reads request headers **once, when the session is created (`initialize`)** — not on each `tools/call`. So:

- ✅ Set `x-actor-role` as a **connection-level header** so it rides on the `initialize` request. It then applies to the whole session. **A session = one actor.**
- ❌ Setting `x-actor-role` on an individual `tools/call` **has no effect** — the tool still sees the `initialize` request's headers. The session then uses the default role (`admin`, full access), so a patient session won't be restricted unless the role rides on `initialize`.

**Testing with raw JSON-RPC (Postman/curl):** put the header on the `initialize` POST that starts the session (the one that returns `mcp-session-id`), then reuse that session for `tools/call`. Putting it only on the `tools/call` will not work — that's the usual "I set the header but it still ran" cause.

Real MCP client libraries send connection-level headers on `initialize` automatically; set `x-actor-role` there alongside `x-api-key`. To switch actor, open a new session.

## Why the role is a header, not a tool argument

The AI model produces tool **arguments**, so a `role` argument could be faked (`role: "admin"`). The role therefore comes from the transport header, which only your trusted client can set. **Never** pass the role as a tool parameter.

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

Enforcement happens in two places automatically:

- **`tools/list` is filtered** — a session only sees the tools its role can use. A `patient` session's tool list contains just the patient-allowed tools; `statistics.*`, `find_patient`, and `list_appointments` / `get_appointment` are omitted.
- **`tools/call` is rejected** for a tool the role lacks (`Access denied: insufficient permissions for tool '…'`), and the backend is never called.

Both are driven by the same per-tool capability, so the list and the call can't drift apart.

## How to use it (per session)

Set `x-actor-role` **on connect** (see the timing note above) based on who is talking to the AI:

- **Patient chatbot** → `x-actor-role: patient`
- **Front-desk / staff assistant** → `x-actor-role: receptionist` (or `doctor` / `admin`)

Behavior when the header is missing or wrong (fail-open to `admin`):

- **Absent** → `admin` (the `DEFAULT_ACTOR_ROLE` constant in `src/common/mcp/authorization.util.ts`). Full access, so a **patient-facing client MUST send `x-actor-role: patient`** to restrict it.
- **Unrecognised value** → also `admin`.

> ⚠️ This is fail-**open**: an unidentified caller gets the full tool surface. To make the default least-privilege instead, set `DEFAULT_ACTOR_ROLE = 'patient'`.

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
