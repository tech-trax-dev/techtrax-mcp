import { Controller, Get } from '@nestjs/common';

/**
 * Plain HTTP liveness probe for container orchestrators (Docker/k8s).
 * Deliberately separate from the MCP transport — not an MCP tool.
 */
@Controller('healthz')
export class HealthController {
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}
