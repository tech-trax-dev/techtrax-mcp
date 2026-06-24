import 'reflect-metadata';
import { HealthTools } from './health.tools';

const TOOL_METADATA_KEY = 'mcp:tool';

type ToolMetadata = {
  name: string;
  description: string;
  annotations?: Record<string, unknown>;
};

const getToolMetadata = (
  target: object,
  methodName: keyof typeof HealthTools.prototype,
): ToolMetadata => {
  const method = (target as Record<string, object>)[methodName];
  return Reflect.getMetadata(TOOL_METADATA_KEY, method) as ToolMetadata;
};

describe('HealthTools — Fix 3 (health.* namespace)', () => {
  const proto = HealthTools.prototype;

  it('exposes dot-namespaced names, not underscore', () => {
    expect(getToolMetadata(proto, 'ping').name).toBe('health.ping');
    expect(getToolMetadata(proto, 'backendHealth').name).toBe('health.backend');
  });

  it('has annotations on both tools', () => {
    const expected = {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    };
    expect(getToolMetadata(proto, 'ping').annotations).toEqual(expected);
    expect(getToolMetadata(proto, 'backendHealth').annotations).toEqual(
      expected,
    );
  });

  it('has descriptive, non-empty descriptions', () => {
    expect(getToolMetadata(proto, 'ping').description).toContain('MCP');
    expect(getToolMetadata(proto, 'backendHealth').description).toContain(
      'backend',
    );
  });
});
