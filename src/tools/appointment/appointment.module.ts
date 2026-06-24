import { Module } from '@nestjs/common';
import { McpModule } from '@rekog/mcp-nest';
import { MCP_SERVER_NAME } from '../../config/mcp.constants';
import { AppointmentTools } from './appointment.tools';

@Module({
  imports: [McpModule.forFeature([AppointmentTools], MCP_SERVER_NAME)],
  providers: [AppointmentTools],
})
export class AppointmentToolsModule {}
