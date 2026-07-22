import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ACTOR_ROLE_REQUEST_KEY } from './authorization.util';

/**
 * Captures the session's actor role from the `initialize` request.
 *
 * The client passes the role in the `initialize` JSON-RPC `params`:
 *   { "method": "initialize", "params": { …, "actorRole": "patient" } }
 *
 * In stateful Streamable HTTP, @rekog/mcp-nest captures THIS request object and
 * reuses it for every later `tools/list` / `tools/call` guard check. So we read
 * `params.actorRole` here (before mcp-nest processes the message) and stamp it
 * onto the request under `ACTOR_ROLE_REQUEST_KEY`; `resolveActorRole` then reads
 * it for the whole session. This guard never blocks — it only annotates.
 *
 * Wire it via `McpModule.forRoot({ guards: [..., ActorRoleCaptureGuard] })`.
 */
@Injectable()
export class ActorRoleCaptureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { [ACTOR_ROLE_REQUEST_KEY]?: string }>();

    const body = req?.body as
      | { method?: unknown; params?: { actorRole?: unknown } }
      | undefined;

    // Only the initialize request establishes the session's role.
    if (body?.method === 'initialize') {
      const role = body.params?.actorRole;
      req[ACTOR_ROLE_REQUEST_KEY] = typeof role === 'string' ? role : undefined;
    }

    return true;
  }
}
