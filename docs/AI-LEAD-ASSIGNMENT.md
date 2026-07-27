# Assign a Lead via MCP Tools — Flow (for the AI team)

This is the **MCP-tool** version of lead assignment: how an AI model
**(re)assigns an EXISTING lead** to an owner using this server's tools, the same
three assignment methods the app's create-lead flow uses.

> Companion to the backend `AI-CREATE-LEAD-FLOW.md`. That doc **creates + assigns**
> a lead over REST. This doc **reassigns an existing** lead (one already created
> by an inbound message / opened conversation) using MCP tools.

It covers:

1. Session setup (headers + per-call `actorRole` argument) — required before any CRM call succeeds.
2. The three tools, the order to call them, and what each returns.
3. The 3 assignment methods and how each maps to `crm.assign_lead` arguments.
4. How "round-robin" is resolved (load-aware, same engine as create).
5. End-to-end examples.

---

## 1. Session setup (headers + per-call `actorRole` argument)

Every CRM call is scoped by request headers **and** the `actorRole` argument your
**client** injects into each `tools/call` (never the AI model).

| Where | Name | Purpose | Example |
| --- | --- | --- | --- |
| Header | `x-api-key` | Authenticates the client | `x-api-key: <MCP_CLIENT_API_KEY>` |
| Header | `x-tenant-id` | Which clinic/workspace to act on (24-hex id) | `x-tenant-id: 6935b6ea…` |
| `tools/call` argument | `actorRole` | Who the AI acts as (per call) — **must be staff for CRM** | `"actorRole": "receptionist"` |

- Pass `actorRole` in the `arguments` of **every** `tools/call` (exactly like
  `tenantId`). It is a per-call argument, **not** set at `initialize` and **not**
  a header. Allowed values: `patient` | `doctor` | `receptionist` | `admin`.
  ```jsonc
  { "method": "tools/call",
    "params": { "name": "crm.list_teams",
                "arguments": { "tenantId": "6935b6ea…", "actorRole": "receptionist" } } }
  ```
- The CRM tools require `lead:read` / `lead:write`, held by **`receptionist`,
  `doctor`, `admin`**. The default role is `patient` (omitted/unknown →
  `patient`), so you **must** inject a staff role into each CRM call — a call with
  `actorRole: patient` (or none) is **rejected**. Note `tools/list` is **not**
  filtered by role, so a patient session still **sees** the CRM tools in the
  catalog; the calls are simply rejected. Use `GET /tool-access?role=receptionist`
  to confirm which tools a staff role can call.

See `docs/MCP_TOOL_AUTHORIZATION.md` for the full authorization model.

---

## 2. The tools, in order

| # | Tool | Capability | Purpose |
| --- | --- | --- | --- |
| 1 | `crm.list_teams` | `lead:read` | List teams (**name + description**) to pick a `teamId` from |
| 2 | `crm.get_team` | `lead:read` | Load a team's **team lead + members** (needed for member ids) |
| 3 | `crm.assign_lead` | `lead:write` | (Re)assign the existing lead — the only **write** |

```
crm.list_teams   → read names/descriptions, pick a teamId
      │
      └─► crm.get_team     → teamLead + member ids   (only for "specific person")
      │
      └─► crm.assign_lead  → assign using one of the 3 methods
```

Step **2** is only needed when you want to assign to a **specific person** (you
need their id). For "team lead" or "round-robin" you can go straight from
`crm.list_teams` to `crm.assign_lead` with just the `teamId`.

### 2.1 `crm.list_teams`

Args: `tenantId` (or the header), `status?` (`active`|`archived`), `search?`,
`page?`, `limit?`, `format?` (`json`|`markdown`).

Returns per team: `id`, **`name`**, **`description`** (what the team handles —
use this + the name to match the lead's conversation), `memberCount`,
`teamLeadName`, `status`, `isSystemReserved`, plus `pagination`.

> The system-reserved **"Unassigned"** team (`isSystemReserved: true`) is the
> no-owner bucket — don't route real leads to it.

### 2.2 `crm.get_team`

Args: `tenantId`, `teamId`, `format?`.

Returns the team's `teamLead` and `members` (each `{ id, name, roleName }`) plus
`description` and `memberCount`. **This is where assignee ids come from:**

- `teamLead.id` → the id for "assign to team lead" (or use method 2, no id needed).
- `members[].id` → ids to choose from for "assign to a specific member".

### 2.3 `crm.assign_lead` (the write)

Args:

| Arg | Required | Notes |
| --- | --- | --- |
| `tenantId` | yes (or header) | 24-hex clinic id |
| `leadId` | **yes** | The existing lead (CustomerProfile) to assign |
| `assignedTo` | conditional | A user id — a `teamLead.id` or `members[].id` |
| `teamId` | conditional | The team to route to |
| `isRoundRobin` | no | With `teamId`, auto-distribute across members |
| `actorUserId` | no | Attribute the assignment to this user id |
| `format` | no | `json` (default) \| `markdown` |

Provide **`assignedTo` or `teamId`** (at least one). Returns the updated lead:
`{ id, firstName, lastName, phone, email, assignedTo, status, assignedAt }`.

---

## 3. Assignment method → arguments

Same three methods as the create flow, mapped to `crm.assign_lead` args:

| Method | Send `assignedTo` | Send `teamId` | Send `isRoundRobin` | Owner resolves to… |
| --- | --- | --- | --- | --- |
| **Specific person** | ✅ the user id | optional* | ❌ | Exactly that user |
| **Team lead** | ❌ | ✅ | ❌ | The team's **team lead** |
| **Auto / round-robin** | ❌ | ✅ | ✅ `true` | Next **member** via load-aware round-robin (lead excluded) |

\* For "specific person" `teamId` is optional; if you send it, the user must
belong to that team.

Minimal argument sets:

```jsonc
// 1. Specific person
{ "leadId": "<L>", "assignedTo": "<userId>" }

// 2. Team lead
{ "leadId": "<L>", "teamId": "<T>" }

// 3. Auto / round-robin
{ "leadId": "<L>", "teamId": "<T>", "isRoundRobin": true }
```

**Rules (rejected before any change):**

- Neither `assignedTo` nor `teamId` → error (nothing to resolve).
- `assignedTo` **and** `isRoundRobin: true` together → error (mutually exclusive).
- Assignee not an active, non-admin member of the tenant/team → backend rejects.
- Unknown `leadId` → "Lead not found".

---

## 4. How round-robin is resolved

`isRoundRobin: true` is business auto-distribution — you don't pick a person, the
backend fairly spreads leads across the team. It uses the **exact same engine as
lead creation** (single source of truth):

- Only **members** participate (**team lead excluded**).
- **Load-aware**: first narrows to the member(s) with the **fewest currently
  open leads**, then rotates within that group via a per-team cursor
  (`Team.leadRoundRobinIndex`). An imbalanced team (e.g. 8 / 2 / 2) converges
  toward equal counts instead of preserving the skew.
- The cursor advances via an atomic Mongo `$inc`, so concurrent / agent-driven
  assignments never hand the same slot to two leads.

---

## 5. End-to-end examples (JSON-RPC `tools/call`)

> A staff `actorRole` (e.g. `receptionist`) is injected into **every** call's
> arguments — it's a per-call argument, so it must be present each time. Send
> `actorRole: patient` (or omit it) and these CRM calls are **rejected** (the
> tools still appear in `tools/list`, which isn't role-filtered).

```jsonc
// 1. Pick a team by reading descriptions
tools/call crm.list_teams { "tenantId": "<TID>", "actorRole": "receptionist", "format": "markdown" }
// → choose a team id, e.g. "6a430b66...e2e1"

// 2. (only for "specific person") load its members
tools/call crm.get_team { "tenantId": "<TID>", "actorRole": "receptionist", "teamId": "6a430b66...e2e1" }
// → teamLead.id, members[].id

// 3a. Auto-distribute across the team (round-robin)
tools/call crm.assign_lead {
  "tenantId": "<TID>", "actorRole": "receptionist", "leadId": "<LEAD>",
  "teamId": "6a430b66...e2e1", "isRoundRobin": true
}

// 3b. …or assign to the team lead
tools/call crm.assign_lead {
  "tenantId": "<TID>", "actorRole": "receptionist", "leadId": "<LEAD>", "teamId": "6a430b66...e2e1"
}

// 3c. …or assign to a specific member
tools/call crm.assign_lead {
  "tenantId": "<TID>", "actorRole": "receptionist", "leadId": "<LEAD>",
  "assignedTo": "66fa1100...bb01"
}
```

### Typical AI decision

Read the lead's conversation → match it to a team via `crm.list_teams`
descriptions → then either round-robin the whole team (3a), send to the lead
(3b), or `crm.get_team` and pick the best person (3c).

---

## 6. Backend mapping (for reference)

Each tool is a thin HTTP call to the backend MCP module, which reuses the app's
own CRM services (no reimplemented queries):

| Tool | Backend endpoint | Reuses |
| --- | --- | --- |
| `crm.list_teams` | `GET /api/v1/mcp/crm/teams` | `team.service.getAllTeams` |
| `crm.get_team` | `GET /api/v1/mcp/crm/teams/:teamId` | `team.service.getTeamById` |
| `crm.assign_lead` | `POST /api/v1/mcp/crm/leads/:leadId/assign` | `lead.service.assignLead` → `resolveLeadAssignee` |

`resolveLeadAssignee` is the **same** resolver `POST /api/crm/leads` (create)
uses, so the three methods behave identically in both flows.
