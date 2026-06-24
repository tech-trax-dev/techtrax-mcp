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
const HEALTH_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

@Injectable()
export class HealthTools {
  constructor(private readonly backend: BackendHttpService) {}

  @Tool({
    name: 'health.ping',
    description:
      'Checks if the MCP server itself is running. Use to verify MCP layer is reachable before diagnosing deeper issues.',
    parameters: z.object({}),
    annotations: HEALTH_ANNOTATIONS,
  })
  ping(): McpToolResult {
    return jsonResult({ status: 'ok', ts: new Date().toISOString() });
  }

  @Tool({
    name: 'health.backend',
    description:
      'Checks if the backend API is reachable from the MCP server. Use to verify the MCP→backend connection is healthy.',
    parameters: z.object({}),
    annotations: HEALTH_ANNOTATIONS,
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
