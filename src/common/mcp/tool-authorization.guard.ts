import 'reflect-metadata';
import { authorize } from './authorization.util';
import type { Capability } from './authorization.util';

/**
 * Capability-based tool authorization.
 *
 * The caller's role is an `actorRole` tool **argument** (see authorization.util
 * + docs/MCP_TOOL_AUTHORIZATION.md), so it is only known at call time. This
 * decorator wraps the tool handler: before the handler runs it reads `actorRole`
 * from the call arguments and, if the role lacks the required capability, returns
 * a "not authorized" result and never invokes the handler (so the backend is
 * never hit).
 *
 * ⚠️ Because the role is an argument (not a session header/param), `tools/list`
 * cannot be filtered by role — every tool is advertised. Enforcement is per-call
 * only. The `GET /tool-access` endpoint exposes the role→tool policy.
 *
 * The capability is also recorded as method metadata (`mcp:capability`) so the
 * tool-access endpoint can enumerate each tool's required capability.
 *
 * Put it next to `@Tool({...})`:
 *
 *   @Tool({ name: 'statistics.get_appointment_summary', ... })
 *   @RequireCapability('statistics:read')
 *   async getAppointmentSummary(args, _ctx, req) { ... }
 */

export const CAPABILITY_METADATA_KEY = 'mcp:capability';

export const RequireCapability = (capability: Capability): MethodDecorator => {
  return (
    _target: object,
    _propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor => {
    const original = descriptor.value as (...callArgs: unknown[]) => unknown;

    const wrapped = function (this: unknown, ...callArgs: unknown[]): unknown {
      const toolArgs = callArgs[0] as { actorRole?: unknown } | undefined;
      const denied = authorize(toolArgs, capability);
      if (denied) return denied;
      return original.apply(this, callArgs) as unknown;
    };

    descriptor.value = wrapped;
    Reflect.defineMetadata(CAPABILITY_METADATA_KEY, capability, wrapped);
    return descriptor;
  };
};
