import { BackendException } from '../errors/backend.exception';
import { isTenantNotFound, tenantNotFound } from './tenant.util';
import { errorResult } from './tool-response.util';
import type { McpToolResult } from './tool-response.util';

/**
 * Options describing how a single tool wants a backend failure rendered.
 * Everything a tool needs to say is data — the mapping logic lives here, once.
 */
export interface ToolErrorOptions {
  /** The tenant the call was scoped to, for a precise "tenant not found". */
  tenantId: string;
  /** Verb phrase for the operation, e.g. `fetch clinic profile`. */
  action: string;
  /**
   * Message for a *resource* 404 (unknown doctor / appointment / ...). Omit
   * when the tool has no meaningful 404 of its own — a 404 then falls through
   * to the generic message. Tenant-not-found is handled separately and always
   * wins, so this never mislabels an unknown tenant as an unknown doctor.
   */
  notFoundMessage?: string;
  /**
   * `write` renders backend validation failures (400/404/409) as
   * "Could not <action>: <backend message>", matching the actionable phrasing
   * booking/rescheduling/cancelling rely on. Defaults to `read`.
   */
  variant?: 'read' | 'write';
}

/**
 * The single place every tool maps a thrown backend error to an MCP tool
 * result. Precedence: tenant-not-found → resource 404 → write validation →
 * generic failure. Centralising this keeps the "unknown tenant" behaviour in
 * one spot instead of repeated in every tool's catch block.
 */
export const handleToolError = (
  error: unknown,
  { tenantId, action, notFoundMessage, variant = 'read' }: ToolErrorOptions,
): McpToolResult => {
  if (isTenantNotFound(error)) return tenantNotFound(tenantId);

  if (
    notFoundMessage &&
    error instanceof BackendException &&
    error.status === 404
  ) {
    return errorResult(notFoundMessage);
  }

  if (variant === 'write' && error instanceof BackendException) {
    // 400/404/409 carry actionable validation messages from the backend.
    return errorResult(`Could not ${action}: ${error.message}`);
  }

  return errorResult(`Failed to ${action}: ${(error as Error).message}`);
};
