import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BackendHttpService } from '../common/backend/backend-http.service';

/**
 * Plain HTTP probes for container orchestrators (Docker/k8s). Deliberately
 * separate from the MCP transport — these are not MCP tools and require no auth.
 *
 * - `/healthz`        liveness:  is the process up? (static, never touches deps)
 * - `/healthz/ready`  readiness: can we actually serve? (verifies the backend)
 */
@Controller('healthz')
export class HealthController {
  constructor(private readonly backend: BackendHttpService) {}

  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }

  /**
   * Readiness: returns 200 only when the TechTrax backend is reachable, so an
   * orchestrator won't route MCP traffic to an instance that can't fulfil it.
   * Returns 503 otherwise.
   */
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async ready(): Promise<{ status: string; backend: string }> {
    try {
      await this.backend.get('/health');
      return { status: 'ok', backend: 'reachable' };
    } catch (err) {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        backend: 'unreachable',
        reason: (err as Error).message,
      });
    }
  }
}
