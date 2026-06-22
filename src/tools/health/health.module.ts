import { Module } from '@nestjs/common';
import { McpModule } from '@rekog/mcp-nest';
import { MCP_SERVER_NAME } from '../../config/mcp.constants';
import { HealthTools } from './health.tools';

/**
 * Health namespace module. `McpModule.forFeature` binds this module's tool
 * providers to the MCP server by name — mcp-nest only auto-discovers tools in
 * the module that directly imports the MCP module, so each namespace registers
 * its own providers here.
 */
@Module({
  imports: [McpModule.forFeature([HealthTools], MCP_SERVER_NAME)],
  providers: [HealthTools],
})
export class HealthToolsModule {}
