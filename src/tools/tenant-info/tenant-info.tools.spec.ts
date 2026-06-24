import 'reflect-metadata';
import type { z } from 'zod';
import { BackendException } from '../../common/errors/backend.exception';
import {
  ClinicProfileOutputSchema,
  DoctorAvailabilityOutputSchema,
  DoctorProfileOutputSchema,
  DoctorsListOutputSchema,
} from '../../contracts/tenant-info.schemas';
import { TenantInfoTools } from './tenant-info.tools';

const TOOL_METADATA_KEY = 'mcp:tool';

type ToolMetadata = {
  name: string;
  description: string;
  parameters?: z.ZodType;
  outputSchema?: z.ZodType;
  annotations?: Record<string, unknown>;
};

const getToolMetadata = (
  target: object,
  methodName: keyof typeof TenantInfoTools.prototype,
): ToolMetadata => {
  const method = (target as Record<string, object>)[methodName];
  return Reflect.getMetadata(TOOL_METADATA_KEY, method) as ToolMetadata;
};

const request = { user: { tenantId: '64b7f0000000000000000001' } };

const emptyDoctorsResponse = {
  doctors: [],
  pagination: {
    page: 1,
    limit: 10,
    total_count: 0,
    has_more: false,
    next_page: null,
  },
};

const paginatedDoctorsResponse = {
  doctors: [
    {
      id: 'doc1',
      fullName: 'Jane Doe',
      specialty: 'Cardiology',
      bio: null,
      presenceStatus: 'present' as const,
      supportsOnline: true,
      supportsOffline: false,
    },
  ],
  pagination: {
    page: 1,
    limit: 1,
    total_count: 3,
    has_more: true,
    next_page: 2,
  },
};

const clinicProfileResponse = {
  name: 'Test Clinic',
  description: null,
  logoUrl: null,
  primaryPhone: '123',
  secondaryPhone: null,
  email: null,
  address: null,
  specialties: ['Cardiology'],
  timezone: 'UTC',
  operatingHours: [
    {
      day: 'monday',
      openTime: '09:00',
      closeTime: '17:00',
      isWorkingDay: true,
    },
  ],
  currentStatus: 'open_now' as const,
};

const doctorProfileResponse = {
  firstName: 'Jane',
  lastName: 'Doe',
  email: null,
  phone: null,
  specialty: 'Cardiology',
  bio: null,
  education: {
    university: null,
    faculty: null,
    major: null,
    graduationYear: null,
    degree: null,
    level: null,
  },
  certifications: [],
  experience: null,
};

const doctorAvailabilityResponse = {
  available: true,
  reason: null,
  availableOnline: true,
  availableOffline: false,
  schedule: [
    {
      day: 'monday',
      startTime: '09:00',
      endTime: '12:00',
      mode: 'online' as const,
    },
  ],
};

describe('TenantInfoTools', () => {
  let backend: { get: jest.Mock };
  let tools: TenantInfoTools;

  beforeEach(() => {
    backend = { get: jest.fn() };
    tools = new TenantInfoTools(backend as never);
  });

  describe('Fix 1 — empty list_doctors is a success, not an error', () => {
    it('returns isError: false with doctors: [] and valid pagination', async () => {
      backend.get.mockResolvedValue(emptyDoctorsResponse);

      const result = await tools.listDoctors(
        { specialty: 'NoSuchSpecialty' },
        undefined,
        request,
      );

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual(emptyDoctorsResponse);
      const parsed = DoctorsListOutputSchema.parse(result.structuredContent);
      expect(parsed.doctors).toEqual([]);
      expect(parsed.pagination.has_more).toBe(false);
      expect(parsed.pagination.next_page).toBeNull();
    });

    it('surfaces backend HTTP errors as isError: true', async () => {
      backend.get.mockRejectedValue(new BackendException(500, 'boom'));

      const result = await tools.listDoctors({}, undefined, request);

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
    });
  });

  describe('Fix 2 — structuredContent + outputSchema on every tool', () => {
    it('get_clinic_profile returns schema-valid structuredContent', async () => {
      backend.get.mockResolvedValue(clinicProfileResponse);
      const result = await tools.getClinicProfile({}, undefined, request);
      expect(result.structuredContent).toEqual(clinicProfileResponse);
      expect(() =>
        ClinicProfileOutputSchema.parse(result.structuredContent),
      ).not.toThrow();
    });

    it('get_doctor_profile returns schema-valid structuredContent', async () => {
      backend.get.mockResolvedValue(doctorProfileResponse);
      const result = await tools.getDoctorProfile(
        { doctorId: 'doc1' },
        undefined,
        request,
      );
      expect(() =>
        DoctorProfileOutputSchema.parse(result.structuredContent),
      ).not.toThrow();
    });

    it('get_doctor_availability returns schema-valid structuredContent', async () => {
      backend.get.mockResolvedValue(doctorAvailabilityResponse);
      const result = await tools.getDoctorAvailability(
        { doctorId: 'doc1' },
        undefined,
        request,
      );
      expect(() =>
        DoctorAvailabilityOutputSchema.parse(result.structuredContent),
      ).not.toThrow();
    });

    it('also returns structuredContent in markdown mode', async () => {
      backend.get.mockResolvedValue(clinicProfileResponse);
      const result = await tools.getClinicProfile(
        { format: 'markdown' },
        undefined,
        request,
      );
      expect(result.content[0].text).toContain('# Test Clinic');
      expect(result.structuredContent).toEqual(clinicProfileResponse);
    });

    it('declares outputSchema on all four tenant_info tools', () => {
      const proto = TenantInfoTools.prototype;
      expect(getToolMetadata(proto, 'getClinicProfile').outputSchema).toBe(
        ClinicProfileOutputSchema,
      );
      expect(getToolMetadata(proto, 'listDoctors').outputSchema).toBe(
        DoctorsListOutputSchema,
      );
      expect(getToolMetadata(proto, 'getDoctorProfile').outputSchema).toBe(
        DoctorProfileOutputSchema,
      );
      expect(getToolMetadata(proto, 'getDoctorAvailability').outputSchema).toBe(
        DoctorAvailabilityOutputSchema,
      );
    });
  });

  describe('Fix 4 — pagination exposes next_page', () => {
    it('passes next_page through structuredContent', async () => {
      backend.get.mockResolvedValue(paginatedDoctorsResponse);
      const result = await tools.listDoctors({ limit: 1 }, undefined, request);
      const parsed = DoctorsListOutputSchema.parse(result.structuredContent);
      expect(parsed.pagination.next_page).toBe(2);
      expect(parsed.pagination.has_more).toBe(true);
    });

    it('renders next_page (not next_offset) in markdown', async () => {
      backend.get.mockResolvedValue(paginatedDoctorsResponse);
      const result = await tools.listDoctors(
        { limit: 1, format: 'markdown' },
        undefined,
        request,
      );
      expect(result.content[0].text).toContain('next_page: 2');
      expect(result.content[0].text).not.toContain('next_offset');
    });
  });

  describe('Fix 5 — presenceStatus input is a strict enum', () => {
    const getPresenceSchema = () => {
      const metadata = getToolMetadata(
        TenantInfoTools.prototype,
        'listDoctors',
      );
      return metadata.parameters as z.ZodObject<{
        presenceStatus: z.ZodType;
      }>;
    };

    it('rejects invalid presenceStatus values at the MCP layer', () => {
      const schema = getPresenceSchema();
      const parsed = schema.safeParse({ presenceStatus: 'online' });
      expect(parsed.success).toBe(false);
    });

    it('accepts present and absent', () => {
      const schema = getPresenceSchema();
      expect(schema.safeParse({ presenceStatus: 'present' }).success).toBe(
        true,
      );
      expect(schema.safeParse({ presenceStatus: 'absent' }).success).toBe(true);
    });
  });
});
