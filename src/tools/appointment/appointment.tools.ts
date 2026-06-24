import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { BackendHttpService } from '../../common/backend/backend-http.service';
import { BackendException } from '../../common/errors/backend.exception';
import { errorResult } from '../../common/mcp/tool-response.util';
import type { McpToolResult } from '../../common/mcp/tool-response.util';
import {
  AppointmentOutputSchema,
  AppointmentsListOutputSchema,
  AvailableSlotsOutputSchema,
  PatientsListOutputSchema,
  SESSION_TYPES,
} from '../../contracts/appointment.schemas';
import type {
  AppointmentOutput,
  AppointmentsListOutput,
  AvailableSlotsOutput,
  PatientsListOutput,
} from '../../contracts/appointment.schemas';

type OutputFormat = 'json' | 'markdown';

type ToolRequest = {
  headers?: Record<string, string | string[] | undefined>;
  user?: {
    tenantId?: string;
    tenant?: { id?: string };
  };
};

const formatSchema = z.enum(['json', 'markdown']).default('json');
const sessionTypeSchema = z.enum(SESSION_TYPES);

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

// Booking / rescheduling create or move state and are NOT safe to auto-retry.
const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

// Cancelling tears down an appointment (and any linked online meeting).
const DESTRUCTIVE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;

@Injectable()
export class AppointmentTools {
  constructor(private readonly backend: BackendHttpService) {}

  @Tool({
    name: 'appointment.find_patient',
    description:
      "Searches the clinic's patients by name, phone, or email to resolve a patientId. Use this FIRST when you need to book an appointment but only know the patient by name/phone/email — booking requires a patientId. Returns per patient: id, fullName, firstName, lastName, email, phone. Results are paginated (read pagination.hasMore; pass `nextPage` as `page` to continue). An empty patients array is a valid result (no match), not an error.",
    parameters: z.object({
      query: z
        .string()
        .min(1)
        .describe('Free-text search over patient name, phone, or email.'),
      page: z.number().int().positive().optional(),
      limit: z.number().int().positive().max(50).optional(),
      format: formatSchema.optional(),
    }),
    outputSchema: PatientsListOutputSchema,
    annotations: READ_ANNOTATIONS,
  })
  async findPatient(
    args: {
      query: string;
      page?: number;
      limit?: number;
      format?: OutputFormat;
    },
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    const format = args.format ?? 'json';
    const tenantId = this.resolveTenantId(request);
    if (!tenantId) return this.missingTenant();

    try {
      const data = await this.getWithTenantHeader<PatientsListOutput>(
        tenantId,
        '/api/v1/mcp/appointments/patients',
        { params: { query: args.query, page: args.page, limit: args.limit } },
      );
      return this.formatResult(data, format, (p) => this.renderPatients(p));
    } catch (e) {
      return errorResult(`Failed to find patients: ${(e as Error).message}`);
    }
  }

  @Tool({
    name: 'appointment.get_available_slots',
    description:
      "Returns bookable times for a doctor. WITHOUT `date`: returns available calendar dates (granularity='dates') for roughly the next two months. WITH `date` (YYYY-MM-DD): returns exact bookable ISO datetimes for that day (granularity='slots'), already excluding booked/past times. Always call this before appointment.book and pass one of the returned slot values verbatim as appointmentDateTime. Optionally filter by sessionType (online | on-site). An empty slots array means nothing is bookable for that input, not an error.",
    parameters: z.object({
      doctorId: z.string().min(1),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
        .optional()
        .describe('Target day (YYYY-MM-DD). Omit to list available dates.'),
      sessionType: sessionTypeSchema.optional(),
      format: formatSchema.optional(),
    }),
    outputSchema: AvailableSlotsOutputSchema,
    annotations: READ_ANNOTATIONS,
  })
  async getAvailableSlots(
    args: {
      doctorId: string;
      date?: string;
      sessionType?: (typeof SESSION_TYPES)[number];
      format?: OutputFormat;
    },
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    const format = args.format ?? 'json';
    const tenantId = this.resolveTenantId(request);
    if (!tenantId) return this.missingTenant();

    try {
      const data = await this.getWithTenantHeader<AvailableSlotsOutput>(
        tenantId,
        `/api/v1/mcp/appointments/available-slots/${encodeURIComponent(args.doctorId)}`,
        { params: { date: args.date, sessionType: args.sessionType } },
      );
      return this.formatResult(data, format, (p) => this.renderSlots(p));
    } catch (e) {
      if (e instanceof BackendException && e.status === 404) {
        return errorResult(
          'Doctor not found. Use tenant_info.list_doctors to retrieve valid doctor IDs.',
        );
      }
      return errorResult(
        `Failed to fetch available slots: ${(e as Error).message}`,
      );
    }
  }

  @Tool({
    name: 'appointment.list_appointments',
    description:
      'Lists appointments for the clinic, newest first. Use this to find an appointmentId to cancel or reschedule. Filter by status (e.g. upcoming, serving, completed, cancelled), doctorId, patientId, and a date range (from/to, ISO). Returns per appointment: id, patientId, patientName, doctorId, doctorName, appointmentDateTime, appointmentEndTime, sessionType, visitType, status, duration. Paginated (read pagination.hasMore; pass `nextPage` as `page`).',
    parameters: z.object({
      status: z.string().min(1).optional(),
      doctorId: z.string().min(1).optional(),
      patientId: z.string().min(1).optional(),
      from: z.string().min(1).optional().describe('ISO start of date range.'),
      to: z.string().min(1).optional().describe('ISO end of date range.'),
      page: z.number().int().positive().optional(),
      limit: z.number().int().positive().max(50).optional(),
      format: formatSchema.optional(),
    }),
    outputSchema: AppointmentsListOutputSchema,
    annotations: READ_ANNOTATIONS,
  })
  async listAppointments(
    args: {
      status?: string;
      doctorId?: string;
      patientId?: string;
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
      format?: OutputFormat;
    },
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    const format = args.format ?? 'json';
    const tenantId = this.resolveTenantId(request);
    if (!tenantId) return this.missingTenant();

    try {
      const data = await this.getWithTenantHeader<AppointmentsListOutput>(
        tenantId,
        '/api/v1/mcp/appointments',
        {
          params: {
            status: args.status,
            doctorId: args.doctorId,
            patientId: args.patientId,
            from: args.from,
            to: args.to,
            page: args.page,
            limit: args.limit,
          },
        },
      );
      return this.formatResult(data, format, (p) => this.renderAppointments(p));
    } catch (e) {
      return errorResult(
        `Failed to list appointments: ${(e as Error).message}`,
      );
    }
  }

  @Tool({
    name: 'appointment.get_appointment',
    description:
      'Returns a single appointment by id: patient, doctor, scheduled time, session type, status, and cancellation details if any. Use to confirm details before rescheduling/cancelling, or to verify a booking.',
    parameters: z.object({
      appointmentId: z.string().min(1),
      format: formatSchema.optional(),
    }),
    outputSchema: AppointmentOutputSchema,
    annotations: READ_ANNOTATIONS,
  })
  async getAppointment(
    args: { appointmentId: string; format?: OutputFormat },
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    const format = args.format ?? 'json';
    const tenantId = this.resolveTenantId(request);
    if (!tenantId) return this.missingTenant();

    try {
      const data = await this.getWithTenantHeader<AppointmentOutput>(
        tenantId,
        `/api/v1/mcp/appointments/${encodeURIComponent(args.appointmentId)}`,
      );
      return this.formatResult(data, format, (p) => this.renderAppointment(p));
    } catch (e) {
      if (e instanceof BackendException && e.status === 404) {
        return errorResult('Appointment not found.');
      }
      return errorResult(
        `Failed to fetch appointment: ${(e as Error).message}`,
      );
    }
  }

  @Tool({
    name: 'appointment.book',
    description:
      "Books a new appointment. Requires patientId (use appointment.find_patient to resolve one), doctorId, appointmentDateTime (an ISO value from appointment.get_available_slots for that doctor), and sessionType (online | on-site). Optionally pass actorUserId to record who performed the booking (a receptionist or the patient); if omitted the booking is attributed to a system actor. The backend validates the slot against the doctor's shift, leave, and existing appointments and rejects overlaps. NOT idempotent — do not retry a successful call. Returns the created appointment.",
    parameters: z.object({
      patientId: z.string().min(1),
      doctorId: z.string().min(1),
      appointmentDateTime: z
        .string()
        .min(1)
        .describe(
          'ISO datetime, taken verbatim from appointment.get_available_slots.',
        ),
      sessionType: sessionTypeSchema,
      actorUserId: z
        .string()
        .min(1)
        .optional()
        .describe(
          'User performing the booking (receptionist or patient). Optional.',
        ),
      format: formatSchema.optional(),
    }),
    outputSchema: AppointmentOutputSchema,
    annotations: WRITE_ANNOTATIONS,
  })
  async book(
    args: {
      patientId: string;
      doctorId: string;
      appointmentDateTime: string;
      sessionType: (typeof SESSION_TYPES)[number];
      actorUserId?: string;
      format?: OutputFormat;
    },
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    const format = args.format ?? 'json';
    const tenantId = this.resolveTenantId(request);
    if (!tenantId) return this.missingTenant();

    try {
      const data = await this.postWithTenantHeader<AppointmentOutput>(
        tenantId,
        '/api/v1/mcp/appointments/book',
        {
          patientId: args.patientId,
          doctorId: args.doctorId,
          appointmentDateTime: args.appointmentDateTime,
          sessionType: args.sessionType,
          actorUserId: args.actorUserId,
        },
      );
      return this.formatResult(data, format, (p) => this.renderAppointment(p));
    } catch (e) {
      return this.writeError(e, 'book appointment');
    }
  }

  @Tool({
    name: 'appointment.reschedule',
    description:
      "Reschedules an existing appointment to a new time. Requires appointmentId, appointmentDateTime (an ISO value from appointment.get_available_slots for the same doctor), and sessionType (online | on-site). Optionally actorUserId. The backend re-validates the new slot against the doctor's shift, work-mode, leave, and conflicts. NOT idempotent. Returns the updated appointment.",
    parameters: z.object({
      appointmentId: z.string().min(1),
      appointmentDateTime: z
        .string()
        .min(1)
        .describe('New ISO datetime from appointment.get_available_slots.'),
      sessionType: sessionTypeSchema,
      actorUserId: z.string().min(1).optional(),
      format: formatSchema.optional(),
    }),
    outputSchema: AppointmentOutputSchema,
    annotations: WRITE_ANNOTATIONS,
  })
  async reschedule(
    args: {
      appointmentId: string;
      appointmentDateTime: string;
      sessionType: (typeof SESSION_TYPES)[number];
      actorUserId?: string;
      format?: OutputFormat;
    },
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    const format = args.format ?? 'json';
    const tenantId = this.resolveTenantId(request);
    if (!tenantId) return this.missingTenant();

    try {
      const data = await this.patchWithTenantHeader<AppointmentOutput>(
        tenantId,
        `/api/v1/mcp/appointments/${encodeURIComponent(args.appointmentId)}/reschedule`,
        {
          appointmentDateTime: args.appointmentDateTime,
          sessionType: args.sessionType,
          actorUserId: args.actorUserId,
        },
      );
      return this.formatResult(data, format, (p) => this.renderAppointment(p));
    } catch (e) {
      return this.writeError(e, 'reschedule appointment');
    }
  }

  @Tool({
    name: 'appointment.cancel',
    description:
      'Cancels an existing appointment. Requires appointmentId. Optionally pass cancelReason, cancelNote (≤150 chars), and actorUserId (who cancelled). Cancelling also removes the appointment from the queue and cancels any linked online meeting. Already-cancelled or completed appointments are rejected. DESTRUCTIVE and NOT idempotent — confirm with the user before calling. Returns the cancelled appointment.',
    parameters: z.object({
      appointmentId: z.string().min(1),
      cancelReason: z.string().min(1).optional(),
      cancelNote: z.string().max(150).optional(),
      actorUserId: z.string().min(1).optional(),
      format: formatSchema.optional(),
    }),
    outputSchema: AppointmentOutputSchema,
    annotations: DESTRUCTIVE_ANNOTATIONS,
  })
  async cancel(
    args: {
      appointmentId: string;
      cancelReason?: string;
      cancelNote?: string;
      actorUserId?: string;
      format?: OutputFormat;
    },
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    const format = args.format ?? 'json';
    const tenantId = this.resolveTenantId(request);
    if (!tenantId) return this.missingTenant();

    try {
      const data = await this.patchWithTenantHeader<AppointmentOutput>(
        tenantId,
        `/api/v1/mcp/appointments/${encodeURIComponent(args.appointmentId)}/cancel`,
        {
          cancelReason: args.cancelReason,
          cancelNote: args.cancelNote,
          actorUserId: args.actorUserId,
        },
      );
      return this.formatResult(data, format, (p) => this.renderAppointment(p));
    } catch (e) {
      return this.writeError(e, 'cancel appointment');
    }
  }

  // ======================== Helpers ========================

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

  private missingTenant(): McpToolResult {
    return errorResult(
      'Tenant context is missing. Please authenticate with a tenant-scoped client.',
    );
  }

  /** Map a backend write failure to a readable, non-throwing tool result. */
  private writeError(e: unknown, action: string): McpToolResult {
    if (e instanceof BackendException) {
      // 400/404/409 carry actionable validation messages from the backend.
      return errorResult(`Could not ${action}: ${e.message}`);
    }
    return errorResult(`Failed to ${action}: ${(e as Error).message}`);
  }

  private getWithTenantHeader<T>(
    tenantId: string,
    url: string,
    config?: {
      params?: Record<string, string | number | boolean | undefined>;
    },
  ): Promise<T> {
    return this.backend.get<T>(url, {
      ...config,
      headers: { 'x-tenant-id': tenantId },
    });
  }

  private postWithTenantHeader<T>(
    tenantId: string,
    url: string,
    data: unknown,
  ): Promise<T> {
    return this.backend.post<T>(url, data, {
      headers: { 'x-tenant-id': tenantId },
    });
  }

  private patchWithTenantHeader<T>(
    tenantId: string,
    url: string,
    data: unknown,
  ): Promise<T> {
    return this.backend.patch<T>(url, data, {
      headers: { 'x-tenant-id': tenantId },
    });
  }

  private formatResult<T>(
    data: T,
    format: OutputFormat,
    markdownFormatter: (payload: T) => string,
  ): McpToolResult {
    const text =
      format === 'markdown'
        ? markdownFormatter(data)
        : JSON.stringify(data, null, 2);
    return {
      content: [{ type: 'text', text }],
      structuredContent: data,
    };
  }

  private renderPatients(data: PatientsListOutput): string {
    const lines =
      data.patients.length > 0
        ? data.patients.map(
            (p) =>
              `- **${p.fullName}** (${p.id}) — phone: ${p.phone ?? 'N/A'}, email: ${p.email ?? 'N/A'}`,
          )
        : ['- No matching patients'];
    return [
      '# Patients',
      '',
      ...lines,
      '',
      '## Pagination',
      `- page: ${data.pagination.page}`,
      `- total: ${data.pagination.total}`,
      `- has_more: ${data.pagination.hasMore}`,
      `- next_page: ${data.pagination.nextPage ?? 'null'}`,
    ].join('\n');
  }

  private renderSlots(data: AvailableSlotsOutput): string {
    const label =
      data.granularity === 'dates' ? 'Available dates' : 'Available slots';
    const lines =
      data.slots.length > 0
        ? data.slots.map((s) => `- ${s}`)
        : ['- None available'];
    return [
      `# ${label}`,
      '',
      `- **Doctor:** ${data.doctorId}`,
      `- **Date:** ${data.date ?? 'N/A'}`,
      '',
      ...lines,
    ].join('\n');
  }

  private renderAppointments(data: AppointmentsListOutput): string {
    const lines =
      data.appointments.length > 0
        ? data.appointments.map(
            (a) =>
              `- **${a.id}** — ${a.patientName ?? a.patientId ?? 'patient'} with ${a.doctorName ?? a.doctorId ?? 'doctor'} @ ${a.appointmentDateTime ?? 'N/A'} (${a.sessionType ?? 'N/A'}, ${a.status ?? 'N/A'})`,
          )
        : ['- No appointments'];
    return [
      '# Appointments',
      '',
      ...lines,
      '',
      '## Pagination',
      `- page: ${data.pagination.page}`,
      `- total: ${data.pagination.total}`,
      `- has_more: ${data.pagination.hasMore}`,
      `- next_page: ${data.pagination.nextPage ?? 'null'}`,
    ].join('\n');
  }

  private renderAppointment(data: AppointmentOutput): string {
    return [
      `# Appointment ${data.id}`,
      '',
      `- **Patient:** ${data.patientName ?? 'N/A'} (${data.patientId ?? 'N/A'})`,
      `- **Doctor:** ${data.doctorName ?? 'N/A'} (${data.doctorId ?? 'N/A'})`,
      `- **When:** ${data.appointmentDateTime ?? 'N/A'} → ${data.appointmentEndTime ?? 'N/A'}`,
      `- **Session type:** ${data.sessionType ?? 'N/A'}`,
      `- **Visit type:** ${data.visitType ?? 'N/A'}`,
      `- **Status:** ${data.status ?? 'N/A'}`,
      `- **Duration (min):** ${data.duration ?? 'N/A'}`,
      `- **Cancel reason:** ${data.cancelReason ?? 'N/A'}`,
      `- **Cancel note:** ${data.cancelNote ?? 'N/A'}`,
    ].join('\n');
  }
}
