import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { BackendHttpService } from '../../common/backend/backend-http.service';
import { BackendException } from '../../common/errors/backend.exception';
import {
  errorResult,
  jsonResult,
  textResult,
} from '../../common/mcp/tool-response.util';
import type { McpToolResult } from '../../common/mcp/tool-response.util';

type OutputFormat = 'json' | 'markdown';

type ToolRequest = {
  headers?: Record<string, string | string[] | undefined>;
  user?: {
    tenantId?: string;
    tenant?: { id?: string };
  };
};

type ClinicOperatingHour = {
  day: string;
  openTime: string | null;
  closeTime: string | null;
  isWorkingDay: boolean;
};

type ClinicProfile = {
  name: string;
  description: string | null;
  logoUrl: string | null;
  primaryPhone: string | null;
  secondaryPhone: string | null;
  email: string | null;
  address: string | null;
  specialties: string[];
  timezone: string;
  operatingHours: ClinicOperatingHour[];
  currentStatus: 'open_now' | 'closed_now' | 'closed_today';
};

type DoctorListItem = {
  id: string;
  fullName: string;
  specialty: string | null;
  bio: string | null;
  presenceStatus: 'present' | 'absent';
  supportsOnline: boolean;
  supportsOffline: boolean;
};

type DoctorsListResponse = {
  doctors: DoctorListItem[];
  pagination: {
    page: number;
    limit: number;
    total_count: number;
    has_more: boolean;
    next_offset: number | null;
  };
};

type DoctorProfile = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  specialty: string | null;
  bio: string | null;
  education: {
    university: string | null;
    faculty: string | null;
    major: string | null;
    graduationYear: number | null;
    degree: string | null;
    level: string | null;
  };
  certifications: Array<{
    certificationName: string | null;
    year: number | null;
  }>;
  experience: '0-2' | '3-5' | '6-8' | '9-10' | '10+' | null;
};

type DoctorAvailability = {
  available: boolean;
  reason: 'absent' | 'no_shift_today' | null;
  availableOnline: boolean;
  availableOffline: boolean;
  schedule: Array<{
    day: string;
    startTime: string | null;
    endTime: string | null;
    mode: 'online' | 'offline' | 'both';
  }>;
};

const formatSchema = z.enum(['json', 'markdown']).default('json');

const TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

@Injectable()
export class TenantInfoTools {
  constructor(private readonly backend: BackendHttpService) {}

  @Tool({
    name: 'tenant_info.get_clinic_profile',
    description:
      "Returns the clinic's identity and operating info: name, description, logo URL, phone numbers, email, address, list of medical specialties, timezone, weekly operating hours, and a live currentStatus. currentStatus is one of open_now (within today's hours), closed_now (a working day but outside hours), or closed_today (not a working day). Use this for any question about the clinic itself — location, contact, services, hours, or whether it is open right now. Do NOT use it for doctor-specific questions.",
    parameters: z.object({
      format: formatSchema.optional(),
    }),
    annotations: TOOL_ANNOTATIONS,
  })
  async getClinicProfile(
    args: { format?: OutputFormat },
    // Context is currently unused but kept in signature for parity with MCP handler contract.
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    const format = args.format ?? 'json';
    const tenantId = this.resolveTenantId(request);
    if (!tenantId) {
      return errorResult(
        'Tenant context is missing. Please authenticate with a tenant-scoped client.',
      );
    }

    try {
      const data = await this.getWithTenantHeader<ClinicProfile>(
        tenantId,
        '/api/v1/mcp/tenant-info/clinic-profile',
      );
      return this.formatResult(data, format, (payload) =>
        this.renderClinicProfileMarkdown(payload),
      );
    } catch (e) {
      if (e instanceof BackendException && e.status === 404) {
        return errorResult('Clinic profile not found for this tenant.');
      }
      return errorResult(
        `Failed to fetch clinic profile: ${(e as Error).message}`,
      );
    }
  }

  @Tool({
    name: 'tenant_info.list_doctors',
    description:
      "Lists and filters doctors in the clinic. Returns per doctor: id, fullName, specialty, bio, presenceStatus (present = currently clocked in / accepting; absent = not), supportsOnline, supportsOffline. Use this to answer 'which doctors' questions (directory, by name, by specialty, by online/offline support, by presence). For one specific doctor's bookable availability use tenant_info.get_doctor_availability; for credentials use tenant_info.get_doctor_profile. Results are paginated: read pagination.has_more and, when true, request the next page using pagination.next_offset (or increment page).",
    parameters: z.object({
      name: z.string().min(1).optional(),
      specialty: z.string().min(1).optional(),
      supportsOnline: z.boolean().optional(),
      supportsOffline: z.boolean().optional(),
      presenceStatus: z.enum(['present', 'absent']).optional(),
      page: z.number().int().positive().optional(),
      limit: z.number().int().positive().max(50).optional(),
      format: formatSchema.optional(),
    }),
    annotations: TOOL_ANNOTATIONS,
  })
  async listDoctors(
    args: {
      name?: string;
      specialty?: string;
      supportsOnline?: boolean;
      supportsOffline?: boolean;
      presenceStatus?: 'present' | 'absent';
      page?: number;
      limit?: number;
      format?: OutputFormat;
    },
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    const format = args.format ?? 'json';
    const tenantId = this.resolveTenantId(request);
    if (!tenantId) {
      return errorResult(
        'Tenant context is missing. Please authenticate with a tenant-scoped client.',
      );
    }

    try {
      const data = await this.getWithTenantHeader<DoctorsListResponse>(
        tenantId,
        '/api/v1/mcp/tenant-info/doctors',
        {
          params: {
            name: args.name,
            specialty: args.specialty,
            supportsOnline: args.supportsOnline,
            supportsOffline: args.supportsOffline,
            presenceStatus: args.presenceStatus,
            page: args.page,
            limit: args.limit,
          },
        },
      );

      if (!data?.doctors?.length) {
        return errorResult(
          'No doctors found. Try removing filters or checking the specialty name.',
        );
      }

      return this.formatResult(data, format, (payload) =>
        this.renderDoctorsMarkdown(payload),
      );
    } catch (e) {
      return errorResult(`Failed to list doctors: ${(e as Error).message}`);
    }
  }

  @Tool({
    name: 'tenant_info.get_doctor_profile',
    description:
      "Returns one doctor's STATIC professional profile: name, email, phone, specialty, bio, education (university/faculty/major/graduationYear/degree/level), certifications (certificationName + year), and experience range (0-2,3-5,6-8,9-10,10+). Use for 'who is this doctor / background / credentials' questions. Does NOT include schedule or availability — use tenant_info.get_doctor_availability for that.",
    parameters: z.object({
      doctorId: z.string().min(1),
      format: formatSchema.optional(),
    }),
    annotations: TOOL_ANNOTATIONS,
  })
  async getDoctorProfile(
    args: { doctorId: string; format?: OutputFormat },
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    const format = args.format ?? 'json';
    const tenantId = this.resolveTenantId(request);
    if (!tenantId) {
      return errorResult(
        'Tenant context is missing. Please authenticate with a tenant-scoped client.',
      );
    }

    try {
      const data = await this.getWithTenantHeader<DoctorProfile>(
        tenantId,
        `/api/v1/mcp/tenant-info/doctors/${encodeURIComponent(args.doctorId)}`,
      );
      return this.formatResult(data, format, (payload) =>
        this.renderDoctorProfileMarkdown(payload),
      );
    } catch (e) {
      if (e instanceof BackendException && e.status === 404) {
        return errorResult(
          'Doctor not found. Use list_doctors to retrieve valid doctor IDs.',
        );
      }
      return errorResult(
        `Failed to fetch doctor profile: ${(e as Error).message}`,
      );
    }
  }

  @Tool({
    name: 'tenant_info.get_doctor_availability',
    description:
      "Returns whether a doctor can be booked TODAY and their weekly schedule. Fields: available (bool); reason (absent = doctor not clocked in; no_shift_today = no working shift for today's weekday; null when available); availableOnline/availableOffline (consultation modes the doctor supports overall); schedule[] of {day,startTime,endTime,mode} where mode is online, offline, or both. Use for 'is Dr X available today / when does Dr X work / online or clinic day' questions. Advisory note: this reflects schedule + presence only; it does NOT count appointment slots, so it cannot confirm an exact bookable time — the booking flow is the source of truth.",
    parameters: z.object({
      doctorId: z.string().min(1),
      format: formatSchema.optional(),
    }),
    annotations: TOOL_ANNOTATIONS,
  })
  async getDoctorAvailability(
    args: { doctorId: string; format?: OutputFormat },
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    const format = args.format ?? 'json';
    const tenantId = this.resolveTenantId(request);
    if (!tenantId) {
      return errorResult(
        'Tenant context is missing. Please authenticate with a tenant-scoped client.',
      );
    }

    try {
      const data = await this.getWithTenantHeader<DoctorAvailability>(
        tenantId,
        `/api/v1/mcp/tenant-info/doctors/${encodeURIComponent(args.doctorId)}/availability`,
      );
      return this.formatResult(data, format, (payload) =>
        this.renderDoctorAvailabilityMarkdown(payload),
      );
    } catch (e) {
      if (e instanceof BackendException && e.status === 404) {
        return errorResult(
          'Doctor not found or has no shift data. Use list_doctors to retrieve valid doctor IDs.',
        );
      }
      return errorResult(
        `Failed to fetch doctor availability: ${(e as Error).message}`,
      );
    }
  }

  private resolveTenantId(request?: ToolRequest): string | null {
    const fromUser = request?.user?.tenantId ?? request?.user?.tenant?.id;
    if (fromUser) return fromUser;

    const headerValue = request?.headers?.['x-tenant-id'];
    if (typeof headerValue === 'string' && headerValue.trim())
      return headerValue.trim();
    if (Array.isArray(headerValue) && headerValue[0]?.trim())
      return headerValue[0].trim();

    return null;
  }

  private async getWithTenantHeader<T>(
    tenantId: string,
    url: string,
    config?: {
      params?: Record<string, string | number | boolean | undefined>;
    },
  ): Promise<T> {
    return this.backend.get<T>(url, {
      ...config,
      headers: {
        'x-tenant-id': tenantId,
      },
    });
  }

  private formatResult<T>(
    data: T,
    format: OutputFormat,
    markdownFormatter: (payload: T) => string,
  ): McpToolResult {
    if (format === 'markdown') {
      return textResult(markdownFormatter(data));
    }
    return jsonResult(data);
  }

  private renderClinicProfileMarkdown(data: ClinicProfile): string {
    const specialties =
      data.specialties.length > 0
        ? data.specialties.map((s) => `- ${s}`).join('\n')
        : '- None';
    const operatingHours =
      data.operatingHours.length > 0
        ? data.operatingHours
            .map((entry) => {
              const hours =
                entry.isWorkingDay && entry.openTime && entry.closeTime
                  ? `${entry.openTime}-${entry.closeTime}`
                  : 'closed';
              return `- ${entry.day}: ${hours}`;
            })
            .join('\n')
        : '- Not configured';

    return [
      `# ${data.name}`,
      '',
      `- **Current status:** ${data.currentStatus}`,
      `- **Timezone:** ${data.timezone}`,
      `- **Primary phone:** ${data.primaryPhone ?? 'N/A'}`,
      `- **Secondary phone:** ${data.secondaryPhone ?? 'N/A'}`,
      `- **Email:** ${data.email ?? 'N/A'}`,
      `- **Address:** ${data.address ?? 'N/A'}`,
      `- **Logo URL:** ${data.logoUrl ?? 'N/A'}`,
      '',
      '## Description',
      data.description ?? 'N/A',
      '',
      '## Specialties',
      specialties,
      '',
      '## Operating Hours',
      operatingHours,
    ].join('\n');
  }

  private renderDoctorsMarkdown(data: DoctorsListResponse): string {
    const doctorsLines = data.doctors.map((doctor) => {
      const modes =
        doctor.supportsOnline && doctor.supportsOffline
          ? 'online + offline'
          : doctor.supportsOnline
            ? 'online only'
            : doctor.supportsOffline
              ? 'offline only'
              : 'no shift modes configured';

      return `- **${doctor.fullName}** (${doctor.id}) — specialty: ${doctor.specialty ?? 'N/A'}, presence: ${doctor.presenceStatus}, modes: ${modes}`;
    });

    return [
      '# Doctors',
      '',
      ...doctorsLines,
      '',
      '## Pagination',
      `- page: ${data.pagination.page}`,
      `- limit: ${data.pagination.limit}`,
      `- total_count: ${data.pagination.total_count}`,
      `- has_more: ${data.pagination.has_more}`,
      `- next_offset: ${data.pagination.next_offset ?? 'null'}`,
    ].join('\n');
  }

  private renderDoctorProfileMarkdown(data: DoctorProfile): string {
    const certifications =
      data.certifications.length > 0
        ? data.certifications
            .map(
              (cert) =>
                `- ${cert.certificationName ?? 'Unnamed certification'} (${cert.year ?? 'N/A'})`,
            )
            .join('\n')
        : '- None';

    return [
      `# ${data.firstName} ${data.lastName}`,
      '',
      `- **Email:** ${data.email ?? 'N/A'}`,
      `- **Phone:** ${data.phone ?? 'N/A'}`,
      `- **Specialty:** ${data.specialty ?? 'N/A'}`,
      `- **Experience:** ${data.experience ?? 'N/A'}`,
      '',
      '## Bio',
      data.bio ?? 'N/A',
      '',
      '## Education',
      `- University: ${data.education.university ?? 'N/A'}`,
      `- Faculty: ${data.education.faculty ?? 'N/A'}`,
      `- Major: ${data.education.major ?? 'N/A'}`,
      `- Graduation Year: ${data.education.graduationYear ?? 'N/A'}`,
      `- Degree: ${data.education.degree ?? 'N/A'}`,
      `- Level: ${data.education.level ?? 'N/A'}`,
      '',
      '## Certifications',
      certifications,
    ].join('\n');
  }

  private renderDoctorAvailabilityMarkdown(data: DoctorAvailability): string {
    const schedule =
      data.schedule.length > 0
        ? data.schedule
            .map(
              (entry) =>
                `- ${entry.day}: ${entry.startTime ?? 'N/A'}-${entry.endTime ?? 'N/A'} (${entry.mode})`,
            )
            .join('\n')
        : '- No schedule configured';

    return [
      '# Doctor Availability',
      '',
      `- **Available today:** ${data.available}`,
      `- **Reason:** ${data.reason ?? 'none'}`,
      `- **Available online:** ${data.availableOnline}`,
      `- **Available offline:** ${data.availableOffline}`,
      '',
      '## Weekly Schedule',
      schedule,
    ].join('\n');
  }
}
