import { resolveTenantId, tenantIdParam } from './tenant.util';

const ARG_TENANT = '64b7f0000000000000000002';
const CTX_TENANT = '64b7f0000000000000000001';

describe('resolveTenantId', () => {
  it('prefers trusted user tenant over the tool argument', () => {
    const resolved = resolveTenantId(
      { user: { tenantId: CTX_TENANT } },
      { tenantId: ARG_TENANT },
    );
    expect(resolved).toBe(CTX_TENANT);
  });

  it('falls back to request.user when no argument is given', () => {
    expect(resolveTenantId({ user: { tenantId: CTX_TENANT } }, {})).toBe(
      CTX_TENANT,
    );
    expect(resolveTenantId({ user: { tenant: { id: CTX_TENANT } } })).toBe(
      CTX_TENANT,
    );
  });

  it('does not use the deprecated x-tenant-id header', () => {
    expect(
      resolveTenantId(
        { headers: { 'x-tenant-id': CTX_TENANT } },
        { tenantId: ARG_TENANT },
      ),
    ).toBe(ARG_TENANT);
    expect(
      resolveTenantId({ headers: { 'x-tenant-id': [CTX_TENANT] } }),
    ).toBeNull();
  });

  it('trims surrounding whitespace and ignores blank sources', () => {
    expect(resolveTenantId(undefined, { tenantId: `  ${ARG_TENANT}  ` })).toBe(
      ARG_TENANT,
    );
    expect(
      resolveTenantId({ user: { tenantId: '   ' } }, { tenantId: '' }),
    ).toBe(null);
  });

  it('returns null when no tenant context is present', () => {
    expect(resolveTenantId({}, {})).toBeNull();
    expect(resolveTenantId()).toBeNull();
  });

  it('accepts a tool-supplied tenant in production', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(resolveTenantId(undefined, { tenantId: ARG_TENANT })).toBe(
        ARG_TENANT,
      );
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe('tenantIdParam', () => {
  it('accepts a 24-character hex ObjectId', () => {
    expect(tenantIdParam.parse(ARG_TENANT)).toBe(ARG_TENANT);
  });

  it('is optional (undefined passes through)', () => {
    expect(tenantIdParam.parse(undefined)).toBeUndefined();
  });

  it('rejects a malformed tenantId', () => {
    expect(() => tenantIdParam.parse('not-an-object-id')).toThrow();
    expect(() => tenantIdParam.parse('123')).toThrow();
  });
});
