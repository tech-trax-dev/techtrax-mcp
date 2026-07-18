import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { BackendHttpService } from '../../common/backend/backend-http.service';
import type { McpToolResult } from '../../common/mcp/tool-response.util';
import { handleToolError } from '../../common/mcp/tool-error.util';
import {
  resolveTenantId,
  missingTenant,
  tenantIdParam,
} from '../../common/mcp/tenant.util';
import type { ToolRequest } from '../../common/mcp/tenant.util';
import {
  ClinicProfileOutputSchema,
  DoctorAvailabilityOutputSchema,
  DoctorProfileOutputSchema,
  DoctorsListOutputSchema,
} from '../../contracts/tenant-info.schemas';
import type {
  ClinicProfileOutput,
  DoctorAvailabilityOutput,
  DoctorProfileOutput,
  DoctorsListOutput,
} from '../../contracts/tenant-info.schemas';

type OutputFormat = 'json' | 'markdown';

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
      tenantId: tenantIdParam,
      format: formatSchema.optional(),
    }),
    outputSchema: ClinicProfileOutputSchema,
    annotations: TOOL_ANNOTATIONS,
  })
  async getClinicProfile(
    args: { tenantId?: string; format?: OutputFormat },
    // Context is currently unused but kept in signature for parity with MCP handler contract.
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    const format = args.format ?? 'json';
    const tenantId = resolveTenantId(request, args);
    if (!tenantId) {
      return missingTenant();
    }

    try {
      const data = await this.getWithTenantHeader<ClinicProfileOutput>(
        tenantId,
        '/api/v1/mcp/tenant-info/clinic-profile',
      );
      return this.formatResult(data, format, (payload) =>
        this.renderClinicProfileMarkdown(payload),
      );
    } catch (e) {
      return handleToolError(e, {
        tenantId,
        action: 'fetch clinic profile',
        notFoundMessage: 'Clinic profile not found for this tenant.',
      });
    }
  }

  @Tool({
    name: 'tenant_info.list_doctors',
    description:
      "Lists and filters doctors in the clinic. Returns per doctor: id, fullName, specialty, presenceStatus (present = currently clocked in / accepting; absent = not), and totalAppointments (completed appointment count). Use this to answer 'which doctors' questions (directory, by name, by specialty, by presence). For one specific doctor's bookable availability and online/offline support use tenant_info.get_doctor_availability; for credentials use tenant_info.get_doctor_profile. Results are paginated: read pagination.has_more. To paginate, pass `next_page` from the previous response as the `page` param in your next call. When `has_more` is false, you have reached the last page. An empty doctors array is a valid result (the clinic has no doctors matching the filters), not an error.",
    parameters: z.object({
      tenantId: tenantIdParam,
      name: z.string().min(1).optional(),
      specialty: z.string().min(1).optional(),
      presenceStatus: z
        .enum(['present', 'absent'])
        .optional()
        .describe(
          "Filter by doctor presence. 'present' = clocked in today. 'absent' = not clocked in.",
        ),
      page: z.number().int().positive().optional(),
      limit: z.number().int().positive().max(50).optional(),
      format: formatSchema.optional(),
    }),
    outputSchema: DoctorsListOutputSchema,
    annotations: TOOL_ANNOTATIONS,
  })
  async listDoctors(
    args: {
      tenantId?: string;
      name?: string;
      specialty?: string;
      presenceStatus?: 'present' | 'absent';
      page?: number;
      limit?: number;
      format?: OutputFormat;
    },
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    const format = args.format ?? 'json';
    const tenantId = resolveTenantId(request, args);
    if (!tenantId) {
      return missingTenant();
    }

    try {
      const data = await this.getWithTenantHeader<DoctorsListOutput>(
        tenantId,
        '/api/v1/mcp/tenant-info/doctors',
        {
          params: {
            name: args.name,
            specialty: args.specialty,
            presenceStatus: args.presenceStatus,
            page: args.page,
            limit: args.limit,
          },
        },
      );

      // An empty `doctors` array is a valid success (no matching doctors),
      // not a failure. Only backend HTTP errors are surfaced as isError.
      return this.formatResult(data, format, (payload) =>
        this.renderDoctorsMarkdown(payload),
      );
    } catch (e) {
      return handleToolError(e, { tenantId, action: 'list doctors' });
    }
  }

  @Tool({
    name: 'tenant_info.get_doctor_profile',
    description:
      "Returns one doctor's STATIC professional profile: name (firstName/lastName/fullName), email, phone, specialty, bio, education (university/faculty/major/graduationYear/degree/level), certifications (certificationName + year), and lifetime totals (totalAppointments, totalPatients). Use for 'who is this doctor / background / credentials' questions. Does NOT include schedule or availability — use tenant_info.get_doctor_availability for that.",
    parameters: z.object({
      tenantId: tenantIdParam,
      doctorId: z.string().min(1),
      format: formatSchema.optional(),
    }),
    outputSchema: DoctorProfileOutputSchema,
    annotations: TOOL_ANNOTATIONS,
  })
  async getDoctorProfile(
    args: { tenantId?: string; doctorId: string; format?: OutputFormat },
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    const format = args.format ?? 'json';
    const tenantId = resolveTenantId(request, args);
    if (!tenantId) {
      return missingTenant();
    }

    try {
      const data = await this.getWithTenantHeader<DoctorProfileOutput>(
        tenantId,
        `/api/v1/mcp/tenant-info/doctors/${encodeURIComponent(args.doctorId)}`,
      );
      return this.formatResult(data, format, (payload) =>
        this.renderDoctorProfileMarkdown(payload),
      );
    } catch (e) {
      return handleToolError(e, {
        tenantId,
        action: 'fetch doctor profile',
        notFoundMessage:
          'Doctor not found. Use list_doctors to retrieve valid doctor IDs.',
      });
    }
  }

  @Tool({
    name: 'tenant_info.get_doctor_availability',
    description:
      "Returns whether a doctor can be booked TODAY and their weekly schedule. Fields: available (bool); reason (absent = doctor not clocked in; no_shift_today = no working shift for today's weekday; null when available); availableOnline/availableOffline (consultation modes the doctor supports overall); schedule[] of {day,startTime,endTime,mode} where mode is online, offline, or both. Use for 'is Dr X available today / when does Dr X work / online or clinic day' questions. Advisory note: this reflects schedule + presence only; it does NOT count appointment slots, so it cannot confirm an exact bookable time — the booking flow is the source of truth.",
    parameters: z.object({
      tenantId: tenantIdParam,
      doctorId: z.string().min(1),
      format: formatSchema.optional(),
    }),
    outputSchema: DoctorAvailabilityOutputSchema,
    annotations: TOOL_ANNOTATIONS,
  })
  async getDoctorAvailability(
    args: { tenantId?: string; doctorId: string; format?: OutputFormat },
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    const format = args.format ?? 'json';
    const tenantId = resolveTenantId(request, args);
    if (!tenantId) {
      return missingTenant();
    }

    try {
      const data = await this.getWithTenantHeader<DoctorAvailabilityOutput>(
        tenantId,
        `/api/v1/mcp/tenant-info/doctors/${encodeURIComponent(args.doctorId)}/availability`,
      );
      return this.formatResult(data, format, (payload) =>
        this.renderDoctorAvailabilityMarkdown(payload),
      );
    } catch (e) {
      return handleToolError(e, {
        tenantId,
        action: 'fetch doctor availability',
        notFoundMessage:
          'Doctor not found or has no shift data. Use list_doctors to retrieve valid doctor IDs.',
      });
    }
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
    // Always include structuredContent so clients with the tool's outputSchema
    // get typed data, regardless of whether the text block is JSON or markdown.
    const text =
      format === 'markdown'
        ? markdownFormatter(data)
        : JSON.stringify(data, null, 2);
    return {
      content: [{ type: 'text', text }],
      structuredContent: data,
    };
  }

  private renderClinicProfileMarkdown(data: ClinicProfileOutput): string {
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

  private renderDoctorsMarkdown(data: DoctorsListOutput): string {
    const doctorsLines = data.doctors.map(
      (doctor) =>
        `- **${doctor.fullName}** (${doctor.id}) — specialty: ${doctor.specialty ?? 'N/A'}, presence: ${doctor.presenceStatus}, completed appointments: ${doctor.totalAppointments}`,
    );

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
      `- next_page: ${data.pagination.next_page ?? 'null'}`,
    ].join('\n');
  }

  private renderDoctorProfileMarkdown(data: DoctorProfileOutput): string {
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
      `# ${data.fullName || 'Doctor'}`,
      '',
      `- **Email:** ${data.email ?? 'N/A'}`,
      `- **Phone:** ${data.phone ?? 'N/A'}`,
      `- **Specialty:** ${data.specialty ?? 'N/A'}`,
      `- **Completed appointments:** ${data.totalAppointments}`,
      `- **Total patients:** ${data.totalPatients}`,
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

  private renderDoctorAvailabilityMarkdown(
    data: DoctorAvailabilityOutput,
  ): string {
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
