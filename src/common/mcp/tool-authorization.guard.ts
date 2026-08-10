import 'reflect-metadata';
import { authorize } from './authorization.util';
import type { Capability } from './authorization.util';
import type { ToolRequest } from './tenant.util';

/**
 * Capability-based tool authorization.
 *
 * Trusted request identity/headers take priority, then callers may use the
 * actorRole tool argument. This decorator resolves the role at call time and
 * blocks unauthorized handlers before they can reach the backend.
 *
 * `tools/list` is not role-filtered; enforcement is per-call. The
 * `GET /tool-access` endpoint exposes the role-to-tool policy.
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
      const request = callArgs[2] as ToolRequest | undefined;
      const denied = authorize(request, toolArgs, capability);
      if (denied) return denied;
      return original.apply(this, callArgs) as unknown;
    };

    descriptor.value = wrapped;
    Reflect.defineMetadata(CAPABILITY_METADATA_KEY, capability, wrapped);
    return descriptor;
  };
};
