import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { BackendHttpService } from '../../common/backend/backend-http.service';
import { errorResult } from '../../common/mcp/tool-response.util';
import type { McpToolResult } from '../../common/mcp/tool-response.util';
import {
  AppointmentSummaryOutputSchema,
  CancellationStatsOutputSchema,
  PatientSummaryOutputSchema,
  DoctorPerformanceOutputSchema,
  FinancialSummaryOutputSchema,
  OperationalStatsOutputSchema,
  ServiceStatsOutputSchema,
  GrowthTrendsOutputSchema,
} from '../../contracts/statistics.schemas';
import type {
  AppointmentSummaryOutput,
  CancellationStatsOutput,
  PatientSummaryOutput,
  DoctorPerformanceOutput,
  FinancialSummaryOutput,
  OperationalStatsOutput,
  ServiceStatsOutput,
  GrowthTrendsOutput,
} from '../../contracts/statistics.schemas';

type OutputFormat = 'json' | 'markdown';

type ToolRequest = {
  headers?: Record<string, string | string[] | undefined>;
  user?: {
    tenantId?: string;
    tenant?: { id?: string };
  };
};

type RangeArgs = {
  from?: string;
  to?: string;
  timezone?: string;
  format?: OutputFormat;
};

const formatSchema = z.enum(['json', 'markdown']).default('json');

// Every statistics tool shares the same period filter. Dates are calendar days
// (YYYY-MM-DD); the backend defaults to the last 7 days when both are omitted.
const rangeParams = {
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD')
    .optional()
    .describe('Inclusive start day (YYYY-MM-DD). Defaults to 7 days ago.'),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD')
    .optional()
    .describe('Inclusive end day (YYYY-MM-DD). Defaults to today.'),
  timezone: z
    .string()
    .min(1)
    .optional()
    .describe('IANA timezone for day boundaries (e.g. Africa/Cairo).'),
  format: formatSchema.optional(),
};

// All statistics reads are pure, idempotent, and safe to auto-retry.
const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

@Injectable()
export class StatisticsTools {
  constructor(private readonly backend: BackendHttpService) {}

  @Tool({
    name: 'statistics.get_appointment_summary',
    description:
      'Aggregate appointment metrics for a date range: total count, status breakdown (completed/cancelled/no-show/upcoming/serving), completion rate, exam-vs-follow-up and online-vs-in-clinic mix, walk-in vs scheduled, first-visit vs returning, billable share, average per day, and a per-day count series. Use for "how busy were we?" / "how many appointments / no-shows last week?" questions. Defaults to the last 7 days.',
    parameters: z.object(rangeParams),
    outputSchema: AppointmentSummaryOutputSchema,
    annotations: READ_ANNOTATIONS,
  })
  async getAppointmentSummary(
    args: RangeArgs,
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    return this.fetchStat<AppointmentSummaryOutput>(
      request,
      args,
      '/api/v1/mcp/statistics/appointment-summary',
      'appointment summary',
      (d) => this.renderAppointmentSummary(d),
    );
  }

  @Tool({
    name: 'statistics.get_cancellation_stats',
    description:
      'Cancellation and no-show analytics for a date range: no-show rate with period-over-period trend, cancellation rate, breakdown by cancel reason (re-schedule / no-show-of-patient / doctor-not-available / receptionist-ended), last-minute (<24h) vs early cancellations, and reschedule rate. Use to diagnose why slots are being lost. Defaults to the last 7 days.',
    parameters: z.object(rangeParams),
    outputSchema: CancellationStatsOutputSchema,
    annotations: READ_ANNOTATIONS,
  })
  async getCancellationStats(
    args: RangeArgs,
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    return this.fetchStat<CancellationStatsOutput>(
      request,
      args,
      '/api/v1/mcp/statistics/cancellations',
      'cancellation statistics',
      (d) => this.renderCancellations(d),
    );
  }

  @Tool({
    name: 'statistics.get_patient_summary',
    description:
      'Patient analytics for a date range: total/active/inactive patients, new patients registered (with trend vs previous period), new vs returning visit split, age-band and gender distribution, and patient distribution across services/protocols. Use for "how many new patients?" / "what does our patient base look like?". Defaults to the last 7 days.',
    parameters: z.object(rangeParams),
    outputSchema: PatientSummaryOutputSchema,
    annotations: READ_ANNOTATIONS,
  })
  async getPatientSummary(
    args: RangeArgs,
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    return this.fetchStat<PatientSummaryOutput>(
      request,
      args,
      '/api/v1/mcp/statistics/patient-summary',
      'patient summary',
      (d) => this.renderPatientSummary(d),
    );
  }

  @Tool({
    name: 'statistics.get_doctor_performance',
    description:
      'Per-doctor performance for a date range (ranked by volume): appointments booked, completed, no-shows, cancellations, unique patients seen, completion/no-show/cancel rates, and revenue attributed to the doctor. Use for "which doctor saw the most patients?" / "who has the highest no-show rate?". Defaults to the last 7 days.',
    parameters: z.object(rangeParams),
    outputSchema: DoctorPerformanceOutputSchema,
    annotations: READ_ANNOTATIONS,
  })
  async getDoctorPerformance(
    args: RangeArgs,
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    return this.fetchStat<DoctorPerformanceOutput>(
      request,
      args,
      '/api/v1/mcp/statistics/doctor-performance',
      'doctor performance',
      (d) => this.renderDoctorPerformance(d),
    );
  }

  @Tool({
    name: 'statistics.get_financial_summary',
    description:
      'Revenue and billing analytics for a date range: total collected revenue, outstanding/pending balance, required amount, collection rate, total discounts, payments count, paying patients, average revenue per payment, revenue split by payment method (cash/bank/card/wallet), and top services by revenue. Use for "what was our revenue?" / "how much is outstanding?". Defaults to the last 7 days.',
    parameters: z.object(rangeParams),
    outputSchema: FinancialSummaryOutputSchema,
    annotations: READ_ANNOTATIONS,
  })
  async getFinancialSummary(
    args: RangeArgs,
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    return this.fetchStat<FinancialSummaryOutput>(
      request,
      args,
      '/api/v1/mcp/statistics/financial-summary',
      'financial summary',
      (d) => this.renderFinancial(d),
    );
  }

  @Tool({
    name: 'statistics.get_operational_stats',
    description:
      'Operational/time analytics for a date range: busiest day of week, peak hours (top 5 by volume), average patient wait time (scheduled vs actual consult start), average real consultation length, an estimated slot-utilization rate (booked vs available doctor minutes), and staff attendance. Use for "when are we busiest?" / "how long do patients wait?". Defaults to the last 7 days.',
    parameters: z.object(rangeParams),
    outputSchema: OperationalStatsOutputSchema,
    annotations: READ_ANNOTATIONS,
  })
  async getOperationalStats(
    args: RangeArgs,
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    return this.fetchStat<OperationalStatsOutput>(
      request,
      args,
      '/api/v1/mcp/statistics/operational',
      'operational statistics',
      (d) => this.renderOperational(d),
    );
  }

  @Tool({
    name: 'statistics.get_service_stats',
    description:
      'Service/specialty analytics for a date range: most popular services/protocols by appointment volume (with share %), top services by revenue, and appointment volume grouped by doctor specialty. Use for "which services are most in demand?" / "which specialty drives the most visits?". Defaults to the last 7 days.',
    parameters: z.object(rangeParams),
    outputSchema: ServiceStatsOutputSchema,
    annotations: READ_ANNOTATIONS,
  })
  async getServiceStats(
    args: RangeArgs,
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    return this.fetchStat<ServiceStatsOutput>(
      request,
      args,
      '/api/v1/mcp/statistics/service-stats',
      'service statistics',
      (d) => this.renderServiceStats(d),
    );
  }

  @Tool({
    name: 'statistics.get_growth_trends',
    description:
      'Growth analytics comparing the selected range to the immediately preceding equal-length period: appointment volume, new patients, and revenue — each with current vs previous totals, percent change, and trend direction. Use for "are we growing?" / "how does this week compare to last?". Defaults to the last 7 days vs the 7 days before that.',
    parameters: z.object(rangeParams),
    outputSchema: GrowthTrendsOutputSchema,
    annotations: READ_ANNOTATIONS,
  })
  async getGrowthTrends(
    args: RangeArgs,
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    return this.fetchStat<GrowthTrendsOutput>(
      request,
      args,
      '/api/v1/mcp/statistics/growth',
      'growth trends',
      (d) => this.renderGrowth(d),
    );
  }

  // ======================== Core ========================

  /** Resolve tenant, call the backend stat endpoint, format the result. */
  private async fetchStat<T>(
    request: ToolRequest | undefined,
    args: RangeArgs,
    url: string,
    action: string,
    markdownFormatter: (payload: T) => string,
  ): Promise<McpToolResult> {
    const format = args.format ?? 'json';
    const tenantId = this.resolveTenantId(request);
    if (!tenantId) return this.missingTenant();

    try {
      const data = await this.getWithTenantHeader<T>(tenantId, url, {
        params: { from: args.from, to: args.to, timezone: args.timezone },
      });
      return this.formatResult(data, format, markdownFormatter);
    } catch (e) {
      return errorResult(`Failed to fetch ${action}: ${(e as Error).message}`);
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

  // ======================== Markdown renderers ========================

  private renderAppointmentSummary(d: AppointmentSummaryOutput): string {
    const status = d.statusBreakdown
      .map((s) => `  - ${s.status}: ${s.count} (${s.percentage}%)`)
      .join('\n');
    return [
      '# Appointment Summary',
      '',
      `- **Total:** ${d.total}`,
      `- **Completion rate:** ${d.completionRate.value}%`,
      `- **Avg per day:** ${d.avgPerDay}`,
      `- **Online / In-clinic:** ${d.sessionTypeMix.online.count} / ${d.sessionTypeMix.inClinic.count}`,
      `- **Walk-in / Scheduled:** ${d.walkInVsScheduled.walkIn.count} / ${d.walkInVsScheduled.scheduled.count}`,
      `- **First-visit / Returning:** ${d.firstVisitVsReturning.firstVisit.count} / ${d.firstVisitVsReturning.returning.count}`,
      '- **Status breakdown:**',
      status || '  - (none)',
    ].join('\n');
  }

  private renderCancellations(d: CancellationStatsOutput): string {
    const reasons = d.reasonBreakdown
      .map((r) => `  - ${r.reason}: ${r.count} (${r.percentage}%)`)
      .join('\n');
    return [
      '# Cancellations & No-shows',
      '',
      `- **No-show rate:** ${d.noShowRate.value}% (trend: ${d.noShowRate.trend ?? 'n/a'})`,
      `- **Cancellation rate:** ${d.cancellationRate.value}% (${d.cancellationRate.count}/${d.cancellationRate.total})`,
      `- **Reschedule rate:** ${d.rescheduleRate.value}%`,
      `- **Last-minute (<24h):** ${d.leadTime.lastMinute.count} (${d.leadTime.lastMinute.percentage}%)`,
      '- **Reasons:**',
      reasons || '  - (none)',
    ].join('\n');
  }

  private renderPatientSummary(d: PatientSummaryOutput): string {
    return [
      '# Patient Summary',
      '',
      `- **Total patients:** ${d.patients.total}`,
      `- **Active / Inactive:** ${d.patients.active.count} / ${d.patients.inactive.count}`,
      `- **New patients:** ${d.newPatients.count} (trend: ${d.newPatients.trend}, prev: ${d.newPatients.previous})`,
      `- **New / Returning visits:** ${d.newVsReturning.new.count} / ${d.newVsReturning.returning.count}`,
      `- **Gender (M/F):** ${d.genderDistribution.male.count} / ${d.genderDistribution.female.count}`,
    ].join('\n');
  }

  private renderDoctorPerformance(d: DoctorPerformanceOutput): string {
    const rows =
      d.doctors.length > 0
        ? d.doctors.map(
            (doc) =>
              `- **${doc.name ?? doc.doctorId}** (${doc.specialty ?? 'N/A'}) — booked ${doc.booked}, completed ${doc.completed} (${doc.completionRate}%), no-show ${doc.noShowRate}%, revenue ${doc.revenue}`,
          )
        : ['- No doctor activity'];
    return ['# Doctor Performance', '', ...rows].join('\n');
  }

  private renderFinancial(d: FinancialSummaryOutput): string {
    const methods = d.byMethod
      .map((m) => `  - ${m.method}: ${m.total} (${m.count})`)
      .join('\n');
    const services = d.byService
      .slice(0, 5)
      .map((s) => `  - ${s.service ?? 'N/A'}: ${s.revenue}`)
      .join('\n');
    return [
      '# Financial Summary',
      '',
      `- **Revenue collected:** ${d.totalRevenue}`,
      `- **Outstanding:** ${d.outstandingBalance}`,
      `- **Collection rate:** ${d.collectionRate.value}%`,
      `- **Discounts:** ${d.totalDiscount}`,
      `- **Avg / payment:** ${d.avgRevenuePerPayment}`,
      '- **By method:**',
      methods || '  - (none)',
      '- **Top services by revenue:**',
      services || '  - (none)',
    ].join('\n');
  }

  private renderOperational(d: OperationalStatsOutput): string {
    const hours = d.peakHours
      .map((h) => `  - ${String(h.hour).padStart(2, '0')}:00 — ${h.count}`)
      .join('\n');
    return [
      '# Operational Stats',
      '',
      `- **Peak day:** ${d.peakDay ?? 'N/A'}`,
      `- **Avg wait time:** ${d.avgWaitTimeMinutes} min`,
      `- **Avg consultation:** ${d.avgConsultationMinutes} min`,
      `- **Slot utilization (est.):** ${d.slotUtilization.value}%`,
      '- **Peak hours:**',
      hours || '  - (none)',
    ].join('\n');
  }

  private renderServiceStats(d: ServiceStatsOutput): string {
    const popular =
      d.popularServices.length > 0
        ? d.popularServices.map(
            (s) => `  - ${s.service}: ${s.count} (${s.percentage}%)`,
          )
        : ['  - (none)'];
    const specialties =
      d.appointmentsBySpecialty.length > 0
        ? d.appointmentsBySpecialty.map((s) => `  - ${s.specialty}: ${s.count}`)
        : ['  - (none)'];
    return [
      '# Service Stats',
      '',
      '- **Most popular services:**',
      ...popular,
      '- **Appointments by specialty:**',
      ...specialties,
    ].join('\n');
  }

  private renderGrowth(d: GrowthTrendsOutput): string {
    const line = (label: string, m: GrowthTrendsOutput['revenue']) =>
      `- **${label}:** ${m.current} vs ${m.previous} (${m.changePercent ?? 'n/a'}%, ${m.trend})`;
    return [
      '# Growth Trends',
      '',
      line('Appointments', d.appointmentVolume),
      line('New patients', d.newPatients),
      line('Revenue', d.revenue),
    ].join('\n');
  }
}
