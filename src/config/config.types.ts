import type { ConfigService } from '@nestjs/config';
import type { Env } from './env.validation';

export type { Env };

/**
 * Typed alias for ConfigService so injected env access is fully type-safe.
 * Usage: `constructor(private readonly config: TypedConfigService) {}`
 */
export type TypedConfigService = ConfigService<Env, true>;
