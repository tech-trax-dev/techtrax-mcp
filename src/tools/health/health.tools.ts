import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { BackendHttpService } from '../../common/backend/backend-http.service';
import { errorResult, jsonResult } from '../../common/mcp/tool-response.util';
import type { McpToolResult } from '../../common/mcp/tool-response.util';

/**
 * Health namespace. Proves the skeleton end-to-end: a pure liveness tool plus
 * a tool that reaches the TechTrax backend through `BackendHttpService`.
 *
 * Pattern to copy for every future tool: zod params -> one backend call ->
 * shape the MCP result. No business logic here.
 */
@Injectable()
export class HealthTools {
  constructor(private readonly backend: BackendHttpService) {}

  @Tool({
    name: 'health_ping',
    description: 'Liveness check of the MCP server itself.',
    parameters: z.object({}),
  })
  ping(): McpToolResult {
    return jsonResult({ status: 'ok', ts: new Date().toISOString() });
  }

  @Tool({
    name: 'health_backend',
    description: 'Verify the MCP server can reach the TechTrax backend.',
    parameters: z.object({}),
  })
  async backendHealth(): Promise<McpToolResult> {
    try {
      const backend = await this.backend.get('/health');
      return jsonResult({ reachable: true, backend });
    } catch (e) {
      return errorResult(`Backend unreachable: ${(e as Error).message}`);
    }
  }
}
