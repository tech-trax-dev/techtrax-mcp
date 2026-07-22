import { Module } from '@nestjs/common';
import { McpModule } from '@rekog/mcp-nest';
import { MCP_SERVER_NAME } from '../../config/mcp.constants';
import { CrmTools } from './crm.tools';

@Module({
  imports: [McpModule.forFeature([CrmTools], MCP_SERVER_NAME)],
  providers: [CrmTools],
})
export class CrmToolsModule {}
