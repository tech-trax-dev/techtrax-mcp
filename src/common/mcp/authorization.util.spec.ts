import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import {
  ROLE_CAPABILITIES,
  resolveActorRole,
  roleCan,
  authorize,
} from './authorization.util';
import type { Capability } from './authorization.util';
import type { ToolRequest } from './tenant.util';
import { ToolCapabilityGuard } from './tool-authorization.guard';

const req = (headers: Record<string, string | undefined>): ToolRequest => ({
  headers,
});

describe('authorization.util', () => {
  describe('resolveActorRole', () => {
    it('reads a valid x-actor-role header (case/space-insensitive)', () => {
      expect(resolveActorRole(req({ 'x-actor-role': 'Patient' }))).toBe(
        'patient',
      );
      expect(resolveActorRole(req({ 'x-actor-role': ' admin ' }))).toBe(
        'admin',
      );
    });

    it('collapses an unknown role to the DEFAULT_ACTOR_ROLE (admin)', () => {
      expect(resolveActorRole(req({ 'x-actor-role': 'superuser' }))).toBe(
        'admin',
      );
    });

    it('falls back to DEFAULT_ACTOR_ROLE (admin) when the header is absent', () => {
      expect(resolveActorRole(req({}))).toBe('admin');
      expect(resolveActorRole(undefined)).toBe('admin');
    });
  });

  describe('policy', () => {
    it('patients get self-service reads + manage their own appointments', () => {
      expect(ROLE_CAPABILITIES.patient).toEqual([
        'clinic:read',
        'slots:read',
        'appointment:write',
      ]);
      // Allowed: browse clinic/doctors, check slots, book/reschedule/cancel.
      expect(roleCan('patient', 'clinic:read')).toBe(true);
      expect(roleCan('patient', 'slots:read')).toBe(true);
      expect(roleCan('patient', 'appointment:write')).toBe(true);
      // Denied: tenant-wide / other-people's data.
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
      const denied = authorize(
        req({ 'x-actor-role': 'patient' }),
        'statistics:read',
      );
      expect(denied?.isError).toBe(true);
      expect(denied?.content[0].text).toMatch(/not authorized/i);
    });

    it('returns null (proceed) when the role holds the capability', () => {
      expect(
        authorize(req({ 'x-actor-role': 'patient' }), 'clinic:read'),
      ).toBeNull();
      expect(
        authorize(req({ 'x-actor-role': 'receptionist' }), 'statistics:read'),
      ).toBeNull();
    });
  });
});

describe('ToolCapabilityGuard (tools/list filter + call enforcement)', () => {
  const makeContext = (
    headers: Record<string, string | undefined>,
  ): ExecutionContext =>
    ({
      getHandler: () => () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
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
      guardFor('statistics:read').canActivate(
        makeContext({ 'x-actor-role': 'patient' }),
      ),
    ).toBe(false);
  });

  it('allows a statistics tool for staff', () => {
    expect(
      guardFor('statistics:read').canActivate(
        makeContext({ 'x-actor-role': 'receptionist' }),
      ),
    ).toBe(true);
  });

  it('allows patient self-service tools (clinic:read, appointment:write)', () => {
    expect(
      guardFor('clinic:read').canActivate(
        makeContext({ 'x-actor-role': 'patient' }),
      ),
    ).toBe(true);
    expect(
      guardFor('appointment:write').canActivate(
        makeContext({ 'x-actor-role': 'patient' }),
      ),
    ).toBe(true);
  });

  it('denies patient-directory / appointment listing for a patient', () => {
    expect(
      guardFor('patient:read').canActivate(
        makeContext({ 'x-actor-role': 'patient' }),
      ),
    ).toBe(false);
    expect(
      guardFor('appointment:read').canActivate(
        makeContext({ 'x-actor-role': 'patient' }),
      ),
    ).toBe(false);
  });

  it('allows a tool with no declared capability', () => {
    expect(
      guardFor(undefined).canActivate(
        makeContext({ 'x-actor-role': 'patient' }),
      ),
    ).toBe(true);
  });
});
