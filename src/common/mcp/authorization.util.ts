import { z } from 'zod';
import { errorResult } from './tool-response.util';
import type { McpToolResult } from './tool-response.util';
import type { ToolRequest } from './tenant.util';

/**
 * Tool authorization for the MCP server.
 *
 * Callers bind role through trusted request identity, the `x-actor-role`
 * header, or the `actorRole` tool argument (in that priority order). Missing
 * or unrecognised roles fall back to `DEFAULT_ACTOR_ROLE` (`patient`, least
 * privilege).
 *
 * `tools/list` is not filtered by role; enforcement happens on each call. A
 * role that lacks a tool's capability receives a "not authorized" result and
 * the backend is never hit. `GET /tool-access` exposes the policy matrix.
 *
 * The API key authenticates the client. Deployments that let the model choose
 * `actorRole` must scope that API key to a trusted agent service.
 *
 * Roles/capabilities are inspired by the backend permission model but are
 * intentionally coarse — the MCP surface is small.
 */

export const ACTOR_ROLES = [
  'patient',
  'doctor',
  'receptionist',
  'admin',
  'lead_agent',
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
  'lead:assign', // CRM: assign an existing lead to a team/member
  'lead:handoff', // CRM: store a qualified lead phone, assign, and hand off
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
  'lead:assign',
  'lead:handoff',
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
  lead_agent: ['clinic:read', 'slots:read', 'lead:read', 'lead:handoff'],
};

const isActorRole = (value: unknown): value is ActorRole =>
  typeof value === 'string' &&
  (ACTOR_ROLES as readonly string[]).includes(value);

/**
 * Role assumed when trusted request identity is omitted or unrecognised.
 * `patient` = least privilege / default-deny: a caller that doesn't identify
 * itself gets only patient-level access, so staff clients MUST pass an explicit
 * `actorRole` (`receptionist` / `doctor` / `admin`). Change this constant to
 * adjust the fallback.
 */
export const DEFAULT_ACTOR_ROLE: ActorRole = 'patient';

/**
 * Tool argument fallback used when trusted request identity/header is absent.
 */
export const actorRoleParam = z
  .enum([...ACTOR_ROLES] as [ActorRole, ...ActorRole[]])
  .describe(
    'Who the AI is acting for: patient | doctor | receptionist | admin | lead_agent. ' +
      'Trusted request identity/header takes priority. Omit for patient least privilege.',
  )
  .optional();

/**
 * Resolve trusted request identity first, then fall back to the tool argument.
 * Unknown roles resolve to patient.
 */
export const resolveActorRole = (
  request?: ToolRequest,
  args?: { actorRole?: unknown },
): ActorRole => {
  const headerValue = request?.headers?.['x-actor-role'];
  const raw =
    request?.user?.role ??
    (Array.isArray(headerValue) ? headerValue[0] : headerValue) ??
    args?.actorRole;
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return isActorRole(normalized) ? normalized : DEFAULT_ACTOR_ROLE;
};

/** Whether a role holds a capability. */
export const roleCan = (role: ActorRole, capability: Capability): boolean =>
  ROLE_CAPABILITIES[role].includes(capability);

/** The roles that hold a given capability (used by the tool-access endpoint). */
export const rolesWithCapability = (capability: Capability): ActorRole[] =>
  ACTOR_ROLES.filter((role) => roleCan(role, capability));

/**
 * Authorization check for a tool handler. Returns an error `McpToolResult` when
 * the caller's resolved role lacks the capability, or
 * `null` to proceed.
 */
export const authorize = (
  request: ToolRequest | undefined,
  args: { actorRole?: unknown } | undefined,
  capability: Capability,
): McpToolResult | null => {
  const role = resolveActorRole(request, args);
  if (roleCan(role, capability)) return null;
  return errorResult(
    `Not authorized: the '${role}' role cannot perform '${capability}'. ` +
      "This action requires staff access — pass actorRole (e.g. 'receptionist').",
  );
};
