import { HttpModule } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/config.types';
import { BackendHttpService } from './backend-http.service';

/**
 * Global gateway module. Configures the outbound HTTP client once (base URL +
 * internal API key header) so every tool shares a single, pre-authenticated
 * channel to the TechTrax Express backend.
 */
@Global()
@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        baseURL: config.get<string>('BACKEND_BASE_URL'),
        timeout: config.get<number>('BACKEND_TIMEOUT_MS'),
        headers: {
          'x-internal-api-key': config.get<string>('BACKEND_API_KEY'),
          'content-type': 'application/json',
        },
      }),
    }),
  ],
  providers: [BackendHttpService],
  exports: [BackendHttpService],
})
export class BackendModule {}
