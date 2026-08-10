# MCP Tool Authorization

Every MCP tool call is scoped by two things your **client** supplies (not the AI model):

| Where | Name | Purpose | Example |
| --- | --- | --- | --- |
| Header | `x-tenant-id` | Which clinic to act on (24-char hex id) | `x-tenant-id: 6935b6ea…` |
| Header | `x-actor-role` | Trusted role for the connection/call | `x-actor-role: lead_agent` |

> In production, `x-api-key` authenticates the client and the trusted `x-tenant-id` / `x-actor-role` headers scope it. Model-produced identity arguments are accepted only for development compatibility.

## Trusted identity

Production clients must send `x-tenant-id` and `x-actor-role` with the authenticated `x-api-key`. Allowed roles are `patient`, `doctor`, `receptionist`, `admin`, and `lead_agent`. The trusted client, not the model, chooses these headers.

```http
x-api-key: <MCP_CLIENT_API_KEY>
x-tenant-id: 6935b6ea...
x-actor-role: lead_agent
```

Development clients may still use `tenantId` and `actorRole` tool arguments for compatibility. Production ignores those arguments for identity selection; missing role falls back to `patient`, and missing trusted tenant context rejects the tool call.

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
| CRM: create a lead | `crm.create_lead` (`lead:create`) | ❌ | ✅ (not `lead_agent`) |
| CRM: assign a lead | `crm.assign_lead` (`lead:assign`) | ❌ | ✅ |

The Meta lead agent uses the four-tool `meta_leads.*` workflow. `meta_leads.list_teams` and `meta_leads.get_team` share the same `lead:read` policy and backend behavior as their original `crm.*` counterparts.

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

## How to use it

Pin `x-actor-role` on the trusted MCP connection based on the workload:

- **Patient chatbot** -> `x-actor-role: patient`
- **Front-desk / staff assistant** -> `x-actor-role: receptionist` (or `doctor` / `admin`)
- **Meta lead agent** -> `x-actor-role: lead_agent`

Behavior when the trusted role is missing or wrong (fail-**closed** to `patient`):

- **Omitted** → `patient` (the `DEFAULT_ACTOR_ROLE` constant in `src/common/mcp/authorization.util.ts`). A staff-facing client must send an explicit trusted role header to reach staff tools.
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
