import { Module } from '@nestjs/common';
import { McpModule } from '@rekog/mcp-nest';
import { MCP_SERVER_NAME } from '../../config/mcp.constants';
import { StatisticsTools } from './statistics.tools';

@Module({
  imports: [McpModule.forFeature([StatisticsTools], MCP_SERVER_NAME)],
  providers: [StatisticsTools],
})
export class StatisticsToolsModule {}
