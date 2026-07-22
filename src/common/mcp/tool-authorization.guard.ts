import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ToolGuards } from '@rekog/mcp-nest';
import { resolveActorRole, roleCan } from './authorization.util';
import type { Capability } from './authorization.util';

/**
 * Capability-based tool guard.
 *
 * @rekog/mcp-nest runs a tool's guards both when LISTING tools (to decide which
 * to advertise) and when CALLING one (to allow/deny). By attaching this guard —
 * via `@RequireCapability(...)` — every tool is:
 *   • hidden from `tools/list` for a role that lacks its capability, and
 *   • rejected on `tools/call` for that role.
 *
 * So a `patient` session only sees (and can call) the patient-allowed tools.
 *
 * The caller's role comes from the `x-actor-role` request header (see
 * authorization.util + docs/MCP_TOOL_AUTHORIZATION.md); the required capability
 * comes from the `@RequireCapability(...)` metadata on the tool method.
 */

export const CAPABILITY_METADATA_KEY = 'mcp:capability';

@Injectable()
export class ToolCapabilityGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const capability = this.reflector.get<Capability | undefined>(
      CAPABILITY_METADATA_KEY,
      context.getHandler(),
    );
    // A tool with no declared capability is unrestricted.
    if (!capability) return true;

    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
    }>();
    const role = resolveActorRole({ headers: request?.headers });
    return roleCan(role, capability);
  }
}

/**
 * Tag a tool with the capability required to see and call it. Applies the
 * capability metadata AND attaches `ToolCapabilityGuard`, so `tools/list` is
 * filtered per role and calls are enforced. Put it next to `@Tool({...})`.
 */
export const RequireCapability = (capability: Capability) =>
  applyDecorators(
    SetMetadata(CAPABILITY_METADATA_KEY, capability),
    ToolGuards([ToolCapabilityGuard]),
  );
