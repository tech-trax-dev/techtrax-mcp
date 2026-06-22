import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  // Buffer early logs until the pino logger is wired in.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  // Graceful shutdown: drain in-flight requests / close transports on SIGTERM.
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  app
    .get(Logger)
    .log(`MCP server listening on http://localhost:${port}/mcp`, 'Bootstrap');
}

void bootstrap();
