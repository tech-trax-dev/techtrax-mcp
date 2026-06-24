import { Module } from '@nestjs/common';
import { McpModule } from '@rekog/mcp-nest';
import { MCP_SERVER_NAME } from '../../config/mcp.constants';
import { TenantInfoTools } from './tenant-info.tools';

@Module({
  imports: [McpModule.forFeature([TenantInfoTools], MCP_SERVER_NAME)],
  providers: [TenantInfoTools],
})
export class TenantInfoToolsModule {}
