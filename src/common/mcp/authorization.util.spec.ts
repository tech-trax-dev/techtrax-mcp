import 'reflect-metadata';
import {
  ROLE_CAPABILITIES,
  resolveActorRole,
  roleCan,
  rolesWithCapability,
  authorize,
} from './authorization.util';
import {
  RequireCapability,
  CAPABILITY_METADATA_KEY,
} from './tool-authorization.guard';

describe('authorization.util', () => {
  describe('resolveActorRole (from the actorRole argument)', () => {
    it('reads a valid actorRole (case/space-insensitive)', () => {
      expect(resolveActorRole({ actorRole: 'Patient' })).toBe('patient');
      expect(resolveActorRole({ actorRole: ' admin ' })).toBe('admin');
    });

    it('collapses an unknown role to the least-privileged patient (fail closed)', () => {
      expect(resolveActorRole({ actorRole: 'superuser' })).toBe('patient');
    });

    it('falls back to least-privilege patient when omitted', () => {
      expect(resolveActorRole({})).toBe('patient');
      expect(resolveActorRole(undefined)).toBe('patient');
    });
  });

  describe('policy', () => {
    it('patients get self-service reads + manage their own appointments', () => {
      expect(ROLE_CAPABILITIES.patient).toEqual([
        'clinic:read',
        'slots:read',
        'appointment:write',
      ]);
      expect(roleCan('patient', 'clinic:read')).toBe(true);
      expect(roleCan('patient', 'appointment:write')).toBe(true);
      expect(roleCan('patient', 'statistics:read')).toBe(false);
      expect(roleCan('patient', 'patient:read')).toBe(false);
      expect(roleCan('patient', 'appointment:read')).toBe(false);
    });

    it('staff and admin get statistics, patient, and lead data', () => {
      for (const role of ['doctor', 'receptionist', 'admin'] as const) {
        expect(roleCan(role, 'statistics:read')).toBe(true);
        expect(roleCan(role, 'patient:read')).toBe(true);
        expect(roleCan(role, 'lead:read')).toBe(true);
        expect(roleCan(role, 'lead:write')).toBe(true);
      }
    });

    it('patients cannot touch CRM leads', () => {
      expect(roleCan('patient', 'lead:read')).toBe(false);
      expect(roleCan('patient', 'lead:write')).toBe(false);
    });
  });

  describe('rolesWithCapability', () => {
    it('lists exactly the roles holding a capability', () => {
      expect(rolesWithCapability('clinic:read')).toEqual([
        'patient',
        'doctor',
        'receptionist',
        'admin',
      ]);
      expect(rolesWithCapability('statistics:read')).toEqual([
        'doctor',
        'receptionist',
        'admin',
      ]);
      expect(rolesWithCapability('lead:write')).toEqual([
        'doctor',
        'receptionist',
        'admin',
      ]);
    });
  });

  describe('authorize', () => {
    it('returns an error result (isError) when the role lacks the capability', () => {
      const denied = authorize({ actorRole: 'patient' }, 'statistics:read');
      expect(denied?.isError).toBe(true);
      expect(denied?.content[0].text).toMatch(/not authorized/i);
    });

    it('returns null (proceed) when the role holds the capability', () => {
      expect(authorize({ actorRole: 'patient' }, 'clinic:read')).toBeNull();
      expect(
        authorize({ actorRole: 'receptionist' }, 'statistics:read'),
      ).toBeNull();
    });
  });
});

describe('RequireCapability decorator (per-call enforcement)', () => {
  class Host {
    calls = 0;

    @RequireCapability('statistics:read')
    run(args: { actorRole?: string }): { ok: true } {
      void args;
      this.calls += 1;
      return { ok: true };
    }
  }

  it('records the capability as method metadata (for the tool-access endpoint)', () => {
    const meta = Reflect.getMetadata(
      CAPABILITY_METADATA_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      Host.prototype.run,
    ) as string;
    expect(meta).toBe('statistics:read');
  });

  it('runs the handler when the role is authorized', () => {
    const host = new Host();
    expect(host.run({ actorRole: 'receptionist' })).toEqual({ ok: true });
    expect(host.calls).toBe(1);
  });

  it('blocks the handler (isError, no invocation) for an unauthorized role', () => {
    const host = new Host();
    const result = host.run({ actorRole: 'patient' }) as unknown as {
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    expect(host.calls).toBe(0);
  });

  it('blocks when actorRole is omitted (defaults to patient)', () => {
    const host = new Host();
    const result = host.run({}) as unknown as { isError?: boolean };
    expect(result.isError).toBe(true);
    expect(host.calls).toBe(0);
  });
});
