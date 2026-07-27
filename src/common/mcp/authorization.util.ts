import { z } from 'zod';
import { errorResult } from './tool-response.util';
import type { McpToolResult } from './tool-response.util';

/**
 * Tool authorization for the MCP server.
 *
 * The caller's role is passed as an `actorRole` tool **argument** — the same way
 * `tenantId` is passed — on each `tools/call`. A patient-facing client sends
 * `actorRole: 'patient'`; a staff/back-office client sends `receptionist` /
 * `doctor` / `admin`. When the argument is omitted (or unrecognised) the role
 * falls back to `DEFAULT_ACTOR_ROLE` (`patient`, least privilege).
 *
 * ⚠️ Because the role is an argument (not a session header/param), it is only
 * known at `tools/call` time — so `tools/list` is NOT filtered by role; every
 * tool is listed. Enforcement happens on the call: a role that lacks a tool's
 * capability gets a "not authorized" result and the backend is never hit. Use
 * the `GET /tool-access` endpoint to discover which role may use which tool.
 *
 * SECURITY: an argument is produced by the AI model, so a model could in
 * principle pass `actorRole: 'admin'`. Keep the trust where it belongs — the
 * TRUSTED client should inject `actorRole` into each call (like it injects
 * `tenantId`), and a patient-facing client should hard-pin `actorRole: 'patient'`
 * so the model can't widen its own access. `actorRole` is authorization scoping
 * for a trusted client, NOT authentication (the real gate is `x-api-key`).
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
 * Role assumed when the `actorRole` argument is omitted or unrecognised.
 * `patient` = least privilege / default-deny: a caller that doesn't identify
 * itself gets only patient-level access, so staff clients MUST pass an explicit
 * `actorRole` (`receptionist` / `doctor` / `admin`). Change this constant to
 * adjust the fallback.
 */
export const DEFAULT_ACTOR_ROLE: ActorRole = 'patient';

/**
 * Shared `actorRole` tool parameter — every guarded tool exposes this so the
 * client can pass the caller's role in the call arguments, exactly like
 * `tenantId`. Optional: omitted → `DEFAULT_ACTOR_ROLE` (`patient`).
 */
export const actorRoleParam = z
  .enum([...ACTOR_ROLES] as [ActorRole, ...ActorRole[]])
  .describe(
    'Who the AI is acting for: patient | doctor | receptionist | admin. ' +
      'Controls which tools are allowed. Omit for a patient (least privilege); ' +
      'a staff/back-office client must pass an explicit role. A patient-facing ' +
      "client should hard-pin 'patient' so the model can't widen its access.",
  )
  .optional();

/**
 * Resolve the caller's role from the `actorRole` tool argument. A recognised
 * value is used as-is; an absent or unrecognised value falls back to
 * `DEFAULT_ACTOR_ROLE`, so the fallback is driven entirely by that one constant.
 */
export const resolveActorRole = (args?: { actorRole?: unknown }): ActorRole => {
  const raw = args?.actorRole;
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
 * the caller's role (from the `actorRole` argument) lacks the capability, or
 * `null` to proceed.
 */
export const authorize = (
  args: { actorRole?: unknown } | undefined,
  capability: Capability,
): McpToolResult | null => {
  const role = resolveActorRole(args);
  if (roleCan(role, capability)) return null;
  return errorResult(
    `Not authorized: the '${role}' role cannot perform '${capability}'. ` +
      "This action requires staff access — pass actorRole (e.g. 'receptionist').",
  );
};
