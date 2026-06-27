import { z } from 'zod';

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().default(3100),
    // Host to bind. 0.0.0.0 is required inside containers so the port is
    // reachable from outside the container; localhost-only for bare-metal dev.
    HOST: z.string().default('0.0.0.0'),
    // Outbound: MCP -> Express
    BACKEND_BASE_URL: z.url(),
    BACKEND_API_KEY: z.string().min(1),
    BACKEND_TIMEOUT_MS: z.coerce.number().default(15000),
    // MCP server identity
    MCP_SERVER_NAME: z.string().default('techtrax-mcp'),
    MCP_SERVER_VERSION: z.string().default('1.0.0'),
    // Inbound: AI client -> MCP. Required in production (see refinement below).
    MCP_CLIENT_API_KEY: z.string().optional(),
    // Comma-separated allowlist of browser origins for CORS. Empty = CORS off
    // (fine for non-browser MCP clients / server-to-server). e.g.
    // "https://app.tech-trax.com,https://admin.tech-trax.com"
    CORS_ALLOWED_ORIGINS: z.string().optional(),
    // Set true when running behind a reverse proxy / load balancer / ingress
    // so Express derives the real client IP from X-Forwarded-For.
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .default('info'),
  })
  // Fail fast if production is deployed without inbound auth — never ship an
  // open /mcp endpoint that can proxy to the backend.
  .refine((env) => env.NODE_ENV !== 'production' || !!env.MCP_CLIENT_API_KEY, {
    error:
      'MCP_CLIENT_API_KEY is required when NODE_ENV=production (inbound auth must be enabled).',
    path: ['MCP_CLIENT_API_KEY'],
  });

export type Env = z.infer<typeof envSchema>;

export const validateEnv = (raw: Record<string, unknown>): Env => {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
};
