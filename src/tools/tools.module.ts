import { Module } from '@nestjs/common';
import { HealthToolsModule } from './health/health.module';

/**
 * Thin barrel that aggregates every tool namespace. Adding a namespace = new
 * folder + module + one import line here. No infra changes required.
 */
@Module({
  imports: [HealthToolsModule],
})
export class ToolsModule {}
