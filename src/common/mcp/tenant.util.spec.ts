import { resolveTenantId, tenantIdParam } from './tenant.util';

const ARG_TENANT = '64b7f0000000000000000002';
const CTX_TENANT = '64b7f0000000000000000001';

describe('resolveTenantId', () => {
  it('prefers trusted user tenant over header and tool argument', () => {
    const resolved = resolveTenantId(
      {
        user: { tenantId: CTX_TENANT },
        headers: { 'x-tenant-id': ARG_TENANT },
      },
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

  it('falls back to the x-tenant-id header (string or array)', () => {
    expect(
      resolveTenantId(
        { headers: { 'x-tenant-id': CTX_TENANT } },
        { tenantId: ARG_TENANT },
      ),
    ).toBe(CTX_TENANT);
    expect(resolveTenantId({ headers: { 'x-tenant-id': [CTX_TENANT] } })).toBe(
      CTX_TENANT,
    );
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

  it('does not trust a model-supplied tenant in production', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(resolveTenantId(undefined, { tenantId: ARG_TENANT })).toBeNull();
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
