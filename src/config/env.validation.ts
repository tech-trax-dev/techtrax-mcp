import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().default(3000),
  // Outbound: MCP -> Express
  BACKEND_BASE_URL: z.url(),
  BACKEND_API_KEY: z.string().min(1),
  BACKEND_TIMEOUT_MS: z.coerce.number().default(15000),
  // MCP server identity
  MCP_SERVER_NAME: z.string().default('techtrax-mcp'),
  MCP_SERVER_VERSION: z.string().default('1.0.0'),
  // Inbound: AI client -> MCP (optional in Phase 1)
  MCP_CLIENT_API_KEY: z.string().optional(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
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
