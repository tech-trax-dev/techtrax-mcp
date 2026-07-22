import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import {
  ACTOR_ROLE_REQUEST_KEY,
  ROLE_CAPABILITIES,
  resolveActorRole,
  roleCan,
  authorize,
} from './authorization.util';
import type { Capability } from './authorization.util';
import { ToolCapabilityGuard } from './tool-authorization.guard';
import { ActorRoleCaptureGuard } from './actor-role-capture.guard';

const reqWithRole = (role?: string) =>
  role === undefined ? {} : { [ACTOR_ROLE_REQUEST_KEY]: role };

describe('authorization.util', () => {
  describe('resolveActorRole (from the captured initialize request)', () => {
    it('reads a valid stamped role (case/space-insensitive)', () => {
      expect(resolveActorRole(reqWithRole('Patient'))).toBe('patient');
      expect(resolveActorRole(reqWithRole(' admin '))).toBe('admin');
    });

    it('collapses an unknown role to the least-privileged patient (fail closed)', () => {
      expect(resolveActorRole(reqWithRole('superuser'))).toBe('patient');
    });

    it('falls back to least-privilege patient when nothing was stamped', () => {
      expect(resolveActorRole(reqWithRole(undefined))).toBe('patient');
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
      expect(roleCan('patient', 'slots:read')).toBe(true);
      expect(roleCan('patient', 'appointment:write')).toBe(true);
      expect(roleCan('patient', 'statistics:read')).toBe(false);
      expect(roleCan('patient', 'patient:read')).toBe(false);
      expect(roleCan('patient', 'appointment:read')).toBe(false);
    });

    it('staff and admin get statistics, patient, and lead data', () => {
      for (const role of ['doctor', 'receptionist', 'admin'] as const) {
        expect(roleCan(role, 'statistics:read')).toBe(true);
        expect(roleCan(role, 'patient:read')).toBe(true);
        expect(roleCan(role, 'appointment:write')).toBe(true);
        expect(roleCan(role, 'lead:read')).toBe(true);
        expect(roleCan(role, 'lead:write')).toBe(true);
      }
    });

    it('patients cannot touch CRM leads', () => {
      expect(roleCan('patient', 'lead:read')).toBe(false);
      expect(roleCan('patient', 'lead:write')).toBe(false);
    });
  });

  describe('authorize', () => {
    it('returns an error result (isError) when the role lacks the capability', () => {
      const denied = authorize(reqWithRole('patient'), 'statistics:read');
      expect(denied?.isError).toBe(true);
      expect(denied?.content[0].text).toMatch(/not authorized/i);
    });

    it('returns null (proceed) when the role holds the capability', () => {
      expect(authorize(reqWithRole('patient'), 'clinic:read')).toBeNull();
      expect(
        authorize(reqWithRole('receptionist'), 'statistics:read'),
      ).toBeNull();
    });
  });
});

describe('ToolCapabilityGuard (tools/list filter + call enforcement)', () => {
  const makeContext = (role?: string): ExecutionContext =>
    ({
      getHandler: () => () => undefined,
      switchToHttp: () => ({ getRequest: () => reqWithRole(role) }),
    }) as unknown as ExecutionContext;

  const guardFor = (
    capability: Capability | undefined,
  ): ToolCapabilityGuard => {
    const reflector = {
      get: jest.fn().mockReturnValue(capability),
    } as unknown as Reflector;
    return new ToolCapabilityGuard(reflector);
  };

  it('denies a statistics tool for a patient (so it is hidden + not callable)', () => {
    expect(
      guardFor('statistics:read').canActivate(makeContext('patient')),
    ).toBe(false);
  });

  it('allows a statistics tool for staff', () => {
    expect(
      guardFor('statistics:read').canActivate(makeContext('receptionist')),
    ).toBe(true);
  });

  it('allows patient self-service tools (clinic:read, appointment:write)', () => {
    expect(guardFor('clinic:read').canActivate(makeContext('patient'))).toBe(
      true,
    );
    expect(
      guardFor('appointment:write').canActivate(makeContext('patient')),
    ).toBe(true);
  });

  it('denies patient-directory / appointment listing for a patient', () => {
    expect(guardFor('patient:read').canActivate(makeContext('patient'))).toBe(
      false,
    );
    expect(
      guardFor('appointment:read').canActivate(makeContext('patient')),
    ).toBe(false);
  });

  it('defaults a role-less session to patient (staff tool denied)', () => {
    expect(
      guardFor('statistics:read').canActivate(makeContext(undefined)),
    ).toBe(false);
  });

  it('allows a tool with no declared capability', () => {
    expect(guardFor(undefined).canActivate(makeContext('patient'))).toBe(true);
  });
});

describe('ActorRoleCaptureGuard (stamps the role from initialize)', () => {
  const guard = new ActorRoleCaptureGuard();

  const ctx = (body: unknown): ExecutionContext => {
    const req: Record<string, unknown> = { body };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      // expose the mutated request for assertions
      __req: req,
    } as unknown as ExecutionContext & { __req: Record<string, unknown> };
  };

  it('stamps params.actorRole from an initialize request', () => {
    const c = ctx({
      method: 'initialize',
      params: { actorRole: 'receptionist' },
    });
    expect(guard.canActivate(c)).toBe(true);
    const req = (c as unknown as { __req: Record<string, unknown> }).__req;
    expect(req[ACTOR_ROLE_REQUEST_KEY]).toBe('receptionist');
  });

  it('stamps undefined when initialize omits actorRole', () => {
    const c = ctx({ method: 'initialize', params: {} });
    guard.canActivate(c);
    const req = (c as unknown as { __req: Record<string, unknown> }).__req;
    expect(req[ACTOR_ROLE_REQUEST_KEY]).toBeUndefined();
  });

  it('does not stamp on a non-initialize request', () => {
    const c = ctx({ method: 'tools/list', params: { actorRole: 'admin' } });
    guard.canActivate(c);
    const req = (c as unknown as { __req: Record<string, unknown> }).__req;
    expect(ACTOR_ROLE_REQUEST_KEY in req).toBe(false);
  });
});
