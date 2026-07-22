import { errorResult } from './tool-response.util';
import type { McpToolResult } from './tool-response.util';
import type { ToolRequest } from './tenant.util';

/**
 * Tool authorization for the MCP server.
 *
 * The caller's role is taken from the `x-actor-role` transport header, which the
 * trusted MCP client sets (e.g. a patient-facing bot sends `x-actor-role:
 * patient`, a front-desk assistant sends `receptionist`).
 *
 * ⚠️ TIMING (stateful Streamable HTTP): @rekg/mcp-nest registers the tool
 * handlers ONCE, at session `initialize`, capturing that request. So the header
 * the tools see is the one on the **initialize / connection** request — NOT on
 * each `tools/call`. Set `x-actor-role` as a connection-level header; it is then
 * bound to the whole session (a session = one actor). A header sent only on an
 * individual `tools/call` is ignored — the session then uses `DEFAULT_ACTOR_ROLE`
 * (`admin`, full access). See docs/MCP_TOOL_AUTHORIZATION.md.
 *
 * SECURITY: the role is NEVER a tool argument. Tool arguments are produced by
 * the AI model, so a role argument could be self-elevated (`role: "admin"`).
 * Reading it from the transport header keeps the trust boundary at the client
 * (authenticated by `x-api-key`), not the model.
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
 * ⚠️ Self-scoping caveat: the header tells us the caller is a *patient*, not
 * *which* patient, so the MCP layer cannot enforce "your own record only". The
 * trusted client MUST constrain `patientId` (on book) and `appointmentId` (on
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
 * Role assumed when the client sends no `x-actor-role` header (or an
 * unrecognised value). `admin` = full access: a caller that doesn't identify
 * itself gets the complete tool surface, so a patient-facing client MUST send an
 * explicit `x-actor-role: patient` to restrict it. Change this constant to
 * adjust the fallback (e.g. back to `patient` for least-privilege/default-deny).
 */
export const DEFAULT_ACTOR_ROLE: ActorRole = 'admin';

const readHeader = (
  request: ToolRequest | undefined,
  name: string,
): string | undefined => {
  const value = request?.headers?.[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
};

/**
 * Resolve the caller's role from the `x-actor-role` header. A recognised value
 * is used as-is; an absent OR unrecognised value falls back to
 * `DEFAULT_ACTOR_ROLE` (currently `admin`), so the fallback is driven entirely
 * by that one constant.
 */
export const resolveActorRole = (request?: ToolRequest): ActorRole => {
  const raw = readHeader(request, 'x-actor-role')?.trim().toLowerCase();
  if (raw && isActorRole(raw)) return raw;
  return DEFAULT_ACTOR_ROLE;
};

/** Whether a role holds a capability. */
export const roleCan = (role: ActorRole, capability: Capability): boolean =>
  ROLE_CAPABILITIES[role].includes(capability);

/**
 * Authorization guard for a tool handler. Returns an error `McpToolResult` when
 * the caller's role lacks the capability, or `null` to proceed. Usage:
 *
 *   const denied = authorize(request, 'statistics:read');
 *   if (denied) return denied;
 */
export const authorize = (
  request: ToolRequest | undefined,
  capability: Capability,
): McpToolResult | null => {
  const role = resolveActorRole(request);
  if (roleCan(role, capability)) return null;
  return errorResult(
    `Not authorized: the '${role}' role cannot perform '${capability}'. ` +
      'This action requires elevated (staff) access.',
  );
};
