import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { AxiosRequestConfig, isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { BackendException } from '../errors/backend.exception';
import { ApiEnvelope } from './backend.types';

/**
 * The single outbound channel from the MCP server to the TechTrax Express
 * backend. Centralises envelope unwrapping and error mapping so tools stay
 * thin and never touch axios/HttpService directly.
 */
@Injectable()
export class BackendHttpService {
  private readonly logger = new Logger(BackendHttpService.name);

  constructor(private readonly http: HttpService) {}

  get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'GET', url });
  }

  post<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return this.request<T>({ ...config, method: 'POST', url, data });
  }

  put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'PUT', url, data });
  }

  patch<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return this.request<T>({ ...config, method: 'PATCH', url, data });
  }

  delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'DELETE', url });
  }

  private async request<T>(config: AxiosRequestConfig): Promise<T> {
    try {
      const res = await firstValueFrom(
        this.http.request<ApiEnvelope<T>>(config),
      );
      // Express wraps payloads as { status, message, data } — unwrap to data.
      // Flat responses (e.g. /health) have no `data`, so return the body as-is.
      return (res.data?.data ?? (res.data as unknown)) as T;
    } catch (err) {
      throw this.toException(err);
    }
  }

  private toException(err: unknown): BackendException {
    if (isAxiosError(err)) {
      const status = err.response?.status ?? 502;
      // Use `||` so empty messages (e.g. localhost AggregateError on ECONNREFUSED)
      // fall through to the axios error code rather than an empty string.
      const message =
        (err.response?.data as { message?: string } | undefined)?.message ||
        err.message ||
        err.code ||
        'Backend request failed';
      this.logger.warn(`Backend call failed [${status}] ${message}`);
      return new BackendException(status, message, err.response?.data);
    }
    this.logger.error('Unexpected backend gateway error', err as Error);
    return new BackendException(502, 'Unexpected backend gateway error');
  }
}
