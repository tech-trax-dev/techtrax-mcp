import { z } from 'zod';
import { BackendException } from '../errors/backend.exception';
import { errorResult } from './tool-response.util';
import type { McpToolResult } from './tool-response.util';

/**
 * The slice of the inbound request every tool needs to resolve its tenant.
 * `user` is populated once real auth is wired; `headers` carries the legacy
 * `x-tenant-id` transport. Shared so all namespaces stay in lockstep.
 */
export type ToolRequest = {
  headers?: Record<string, string | string[] | undefined>;
  user?: {
    tenantId?: string;
    tenant?: { id?: string };
    role?: string;
  };
};

/** A tenant id is a MongoDB ObjectId — 24 hex chars. */
const OBJECT_ID = /^[a-f\d]{24}$/i;

/**
 * Shared `tenantId` tool parameter. Every tool exposes this so an AI model can
 * pass the tenant explicitly in the call arguments and get a clear validation
 * error on a malformed value. Optional at the schema level so clients that
 * still supply the tenant via the `x-tenant-id` header keep working.
 */
export const tenantIdParam = z
  .string()
  .trim()
  .regex(OBJECT_ID, 'tenantId must be a 24-character hex id (MongoDB ObjectId)')
  .describe(
    'The tenant (clinic) to act on, as a 24-character hex id. Pass this on ' +
      'every call. May be omitted only when the client supplies the tenant ' +
      'via the x-tenant-id header.',
  )
  .optional();

/**
 * Resolve the active tenant for a tool call. Precedence:
 *   1. An authenticated `request.user`.
 *   2. The trusted `x-tenant-id` transport header.
 *   3. Explicit `tenantId` tool argument (legacy clients only).
 * Returns a trimmed, non-empty id or null when no tenant context is present.
 */
export const resolveTenantId = (
  request?: ToolRequest,
  args?: { tenantId?: string },
): string | null => {
  const fromUser = (
    request?.user?.tenantId ??
    request?.user?.tenant?.id ??
    ''
  ).trim();
  if (fromUser) return fromUser;

  const headerValue = request?.headers?.['x-tenant-id'];
  if (typeof headerValue === 'string' && headerValue.trim())
    return headerValue.trim();
  if (Array.isArray(headerValue) && headerValue[0]?.trim())
    return headerValue[0].trim();

  const fromArgs = args?.tenantId?.trim();
  if (fromArgs) return fromArgs;

  return null;
};

/** Uniform "no tenant" result surfaced to the model without throwing. */
export const missingTenant = (): McpToolResult =>
  errorResult(
    'Tenant context is missing. Pass a `tenantId` argument (24-char hex id) ' +
      'or connect with a tenant-scoped client.',
  );

/**
 * True when a backend failure is specifically "this tenant does not exist".
 * The backend tags these with a `TENANT_NOT_FOUND` errorCode on a 404 so it can
 * be told apart from other 404s (e.g. an unknown doctor or appointment id),
 * which carry their own, resource-specific messages.
 */
export const isTenantNotFound = (error: unknown): boolean =>
  error instanceof BackendException &&
  error.status === 404 &&
  (error.payload as { errorCode?: string } | undefined)?.errorCode ===
    'TENANT_NOT_FOUND';

/** Uniform "tenant not found" result surfaced to the model without throwing. */
export const tenantNotFound = (tenantId: string): McpToolResult =>
  errorResult(
    `Tenant not found: no clinic exists with id ${tenantId}. Verify the ` +
      'tenantId (a 24-character hex MongoDB ObjectId) and try again.',
  );
