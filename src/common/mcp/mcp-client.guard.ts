import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { Env } from '../../config/config.types';

/**
 * Optional inbound auth for the MCP endpoint. Validates an `x-api-key` header
 * against `MCP_CLIENT_API_KEY`. When the env var is unset (Phase 1 default),
 * the guard is a no-op so local clients/Inspector connect freely.
 *
 * Wire it via `McpModule.forRoot({ guards: [McpClientGuard] })` once a key is
 * configured.
 */
@Injectable()
export class McpClientGuard implements CanActivate {
  private readonly logger = new Logger(McpClientGuard.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get('MCP_CLIENT_API_KEY', { infer: true });

    // No key configured -> auth disabled (Phase 1 default).
    if (!expected) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.headers['x-api-key'];

    if (provided !== expected) {
      this.logger.warn('Rejected MCP client: missing/invalid x-api-key');
      throw new UnauthorizedException('Invalid MCP client API key');
    }
    return true;
  }
}
