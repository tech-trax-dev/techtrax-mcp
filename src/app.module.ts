import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { McpModule, McpTransportType } from '@rekog/mcp-nest';
import { LoggerModule } from 'nestjs-pino';
import { BackendModule } from './common/backend/backend.module';
import { McpClientGuard } from './common/mcp/mcp-client.guard';
import { Env } from './config/config.types';
import { validateEnv } from './config/env.validation';
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from './config/mcp.constants';
import { HealthController } from './health/health.controller';
import { ToolsModule } from './tools/tools.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          // Redact secrets and auth headers — never leak keys or PHI to logs.
          redact: {
            paths: [
              'req.headers["x-internal-api-key"]',
              'req.headers["x-api-key"]',
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
            ],
            remove: true,
          },
          transport:
            config.get('NODE_ENV', { infer: true }) !== 'production'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),

    // STREAMABLE_HTTP only (stateful sessions). STDIO + SSE disabled.
    McpModule.forRoot({
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
      transport: [McpTransportType.STREAMABLE_HTTP],
      streamableHttp: {
        enableJsonResponse: false,
        sessionIdGenerator: () => randomUUID(),
        statelessMode: false,
      },
      // Inbound auth. The guard is a no-op when MCP_CLIENT_API_KEY is unset
      // (local/dev); it enforces `x-api-key` once the key is configured, and
      // env validation makes the key mandatory in production.
      guards: [McpClientGuard],
    }),

    BackendModule,
    ToolsModule,
  ],
  controllers: [HealthController],
  providers: [McpClientGuard],
})
export class AppModule {}
