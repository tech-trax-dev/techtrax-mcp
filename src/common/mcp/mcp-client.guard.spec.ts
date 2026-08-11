import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import { McpClientGuard } from './mcp-client.guard';

const contextWithHeaders = (
  headers: Record<string, string | string[] | undefined>,
): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  }) as ExecutionContext;

describe('McpClientGuard', () => {
  it('rejects the deprecated x-tenant-id header', () => {
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const guard = new McpClientGuard(
      config as unknown as ConfigService<Record<string, unknown>, true>,
    );

    expect(() =>
      guard.canActivate(
        contextWithHeaders({
          'x-tenant-id': '64b7f0000000000000000001',
        }),
      ),
    ).toThrow(BadRequestException);
  });
});
