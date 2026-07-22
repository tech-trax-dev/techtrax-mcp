import { errorResult } from './tool-response.util';
import type { McpToolResult } from './tool-response.util';

/**
 * Tool authorization for the MCP server.
 *
 * The caller's role is chosen ONCE, at session start: the client passes
 * `actorRole` in the `initialize` request's `params` (a patient-facing bot sends
 * `actorRole: 'patient'`; a staff/back-office client sends `receptionist` /
 * `doctor` / `admin`). The role is captured from that request
 * (`ActorRoleCaptureGuard`) and applies to the WHOLE session — a session = one
 * actor — so it scopes both `tools/list` (which tools are advertised) and
 * `tools/call` (which tools may run).
 *
 * ⚠️ TIMING (stateful Streamable HTTP): @rekog/mcp-nest captures the request at
 * session `initialize` and reuses it for every later `tools/list` / `tools/call`.
 * That's why the role must ride the `initialize` request — a value sent on a
 * later `tools/call` is not seen. When no `actorRole` is supplied at init, the
 * session falls back to `DEFAULT_ACTOR_ROLE` (`patient`, least privilege).
 *
 * SECURITY: the role is NOT a per-call tool argument. Tool arguments are produced
 * by the AI model, so a role argument could be self-elevated (`role: "admin"`).
 * The role comes from the client's `initialize` request (authenticated by
 * `x-api-key`), which the model cannot influence.
 *
 * Roles/capabilities are inspired by the backend permission model but are
 * intentionally coarse — the MCP surface is small.
 */

export const ACTOR_ROLES = [
  'patient',
  'doctor',
  'receptionist',
  'admin',
] as const;
export type ActorRole = (typeof ACTOR_ROLES)[number];

export const CAPABILITIES = [
  'clinic:read', // clinic profile + doctor directory (public-facing)
  'slots:read', // a doctor's bookable slots/dates
  'patient:read', // search patients (PII across the tenant)
  'appointment:read', // list / fetch appointments (other patients' data)
  'appointment:write', // book / reschedule / cancel
  'statistics:read', // tenant-wide analytics
  'lead:read', // CRM: list teams + members (for lead routing)
  'lead:write', // CRM: create + assign a lead to a team/member
] as const;
export type Capability = (typeof CAPABILITIES)[number];

// Staff (doctor / receptionist) get the full operational surface. Admin is a
// superset (identical here, but kept distinct so policy can diverge later).
const STAFF: Capability[] = [
  'clinic:read',
  'slots:read',
  'patient:read',
  'appointment:read',
  'appointment:write',
  'statistics:read',
  'lead:read',
  'lead:write',
];

/**
 * Role → allowed capabilities. Edit this map to adjust who can do what.
 *
 * Patients get the self-service set: browse the clinic / doctors / specialties
 * and tenant info (`clinic:read`), check a doctor's slots (`slots:read`), and
 * manage their own appointments — book / reschedule / cancel (`appointment:write`).
 * They are NOT given `patient:read` (search the whole patient directory),
 * `appointment:read` (list every appointment in the tenant), or
 * `statistics:read` (tenant-wide analytics) — those expose other people's data.
 *
 * ⚠️ Self-scoping caveat: the role says the caller is a *patient*, not *which*
 * patient, so the MCP layer cannot enforce "your own record only". The trusted
 * client MUST constrain `patientId` (on book) and `appointmentId` (on
 * reschedule/cancel) to the signed-in patient. See docs/MCP_TOOL_AUTHORIZATION.md.
 */
export const ROLE_CAPABILITIES: Record<ActorRole, readonly Capability[]> = {
  patient: ['clinic:read', 'slots:read', 'appointment:write'],
  doctor: STAFF,
  receptionist: STAFF,
  admin: CAPABILITIES,
};

const isActorRole = (value: unknown): value is ActorRole =>
  typeof value === 'string' &&
  (ACTOR_ROLES as readonly string[]).includes(value);

/**
 * Role assumed when the `initialize` request supplies no (or an unrecognised)
 * `actorRole`. `patient` = least privilege / default-deny: a session that
 * doesn't identify itself gets only patient-level access, so staff clients MUST
 * pass an explicit `actorRole` (`receptionist` / `doctor` / `admin`) at init.
 * Change this constant to adjust the fallback.
 */
export const DEFAULT_ACTOR_ROLE: ActorRole = 'patient';

/**
 * The name under which `ActorRoleCaptureGuard` stamps the resolved role onto the
 * `initialize` request object (which mcp-nest reuses for the whole session).
 */
export const ACTOR_ROLE_REQUEST_KEY = 'mcpActorRole';

/**
 * The request slice the role resolver reads: the `actorRole` stamped on the
 * (captured `initialize`) request by `ActorRoleCaptureGuard`.
 */
export type ActorRoleRequest =
  | { [ACTOR_ROLE_REQUEST_KEY]?: unknown }
  | undefined;

/**
 * Resolve the session's role from the request captured at `initialize`. A
 * recognised value is used as-is; anything else (absent / unknown) falls back to
 * `DEFAULT_ACTOR_ROLE`, so the fallback is driven entirely by that one constant.
 */
export const resolveActorRole = (request?: ActorRoleRequest): ActorRole => {
  const raw = request?.[ACTOR_ROLE_REQUEST_KEY];
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return isActorRole(normalized) ? normalized : DEFAULT_ACTOR_ROLE;
};

/** Whether a role holds a capability. */
export const roleCan = (role: ActorRole, capability: Capability): boolean =>
  ROLE_CAPABILITIES[role].includes(capability);

/**
 * Authorization check. Returns an error `McpToolResult` when the session's role
 * lacks the capability, or `null` to proceed.
 */
export const authorize = (
  request: ActorRoleRequest,
  capability: Capability,
): McpToolResult | null => {
  const role = resolveActorRole(request);
  if (roleCan(role, capability)) return null;
  return errorResult(
    `Not authorized: the '${role}' role cannot perform '${capability}'. ` +
      "This action requires staff access — connect with an explicit actorRole (e.g. 'receptionist') at initialize.",
  );
};
