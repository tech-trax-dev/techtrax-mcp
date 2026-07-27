import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { McpClientGuard } from '../common/mcp/mcp-client.guard';
import { ACTOR_ROLES } from '../common/mcp/authorization.util';
import type { ActorRole } from '../common/mcp/authorization.util';
import { ToolAccessService } from './tool-access.service';

const isActorRole = (v: unknown): v is ActorRole =>
  typeof v === 'string' && (ACTOR_ROLES as readonly string[]).includes(v);

/**
 * Plain HTTP discovery endpoint for the tool authorization policy.
 *
 *   GET /tool-access            → full matrix (every tool → allowed roles,
 *                                 plus each role's tool list + capabilities)
 *   GET /tool-access?role=patient → just the tools that one role may call
 *
 * This is read-only policy metadata (no PHI). It exists because, with the role
 * passed as a per-call `actorRole` argument, `tools/list` is not role-filtered —
 * so this endpoint is how a client discovers "which role can use which tool".
 *
 * Guarded by `McpClientGuard` for parity with the `/mcp` endpoint: it requires
 * the same `x-api-key` when `MCP_CLIENT_API_KEY` is configured (a no-op in dev
 * where the key is unset).
 */
@UseGuards(McpClientGuard)
@Controller('tool-access')
export class ToolAccessController {
  constructor(private readonly toolAccess: ToolAccessService) {}

  @Get()
  get(@Query('role') role?: string) {
    if (role === undefined || role === '') {
      return this.toolAccess.matrix();
    }
    const normalized = role.trim().toLowerCase();
    if (!isActorRole(normalized)) {
      throw new BadRequestException(
        `Unknown role '${role}'. Valid roles: ${ACTOR_ROLES.join(', ')}.`,
      );
    }
    return this.toolAccess.forRole(normalized);
  }
}
