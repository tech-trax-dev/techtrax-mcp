import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { Env } from './config/config.types';

async function bootstrap() {
  // Buffer early logs until the pino logger is wired in.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  // Graceful shutdown: drain in-flight requests / close transports on SIGTERM.
  app.enableShutdownHooks();

  const config = app.get(ConfigService<Env, true>);

  // Behind a reverse proxy / LB / ingress, trust X-Forwarded-* so client IPs in
  // logs (and any rate limiting) reflect the real caller, not the proxy.
  if (config.get('TRUST_PROXY', { infer: true })) {
    app.set('trust proxy', 1);
  }

  // CORS only matters for browser-based MCP clients. Off by default; enable by
  // listing origins in CORS_ALLOWED_ORIGINS. Mcp-Session-Id must be exposed so
  // the streamable-HTTP transport can resume sessions across requests.
  const origins = config.get('CORS_ALLOWED_ORIGINS', { infer: true });
  if (origins) {
    app.enableCors({
      origin: origins.split(',').map((o) => o.trim()),
      allowedHeaders: ['content-type', 'x-api-key', 'mcp-session-id'],
      exposedHeaders: ['mcp-session-id'],
      credentials: true,
    });
  }

  const host = config.get('HOST', { infer: true });
  const port = config.get('PORT', { infer: true });
  await app.listen(port, host);

  app
    .get(Logger)
    .log(
      `${config.get('MCP_SERVER_NAME', { infer: true })} ` +
        `v${config.get('MCP_SERVER_VERSION', { infer: true })} ` +
        `listening on http://${host}:${port}/mcp`,
      'Bootstrap',
    );
}

void bootstrap();
