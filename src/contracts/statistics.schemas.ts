import { z } from 'zod';

/**
 * Protocol-level output contracts for every `statistics.*` tool.
 *
 * Attached to each `@Tool({ outputSchema })` so `tools/list` advertises the exact
 * returned shape and clients can rely on `structuredContent`. They mirror the
 * payloads produced by the TechTrax backend `statistics.service.js` (which in turn
 * reuses `dashboard.service.js` / payment aggregations). Fields the backend may
 * omit or null out are `.nullable()`. Schemas are intentionally permissive on
 * numeric shapes because some reused dashboard helpers emit `percentage` as a
 * stringified number ("12.5") while the new aggregations emit real numbers.
 */

const numeric = z.union([z.number(), z.string()]);

const CountPct = z.object({
  count: z.number(),
  percentage: numeric,
});

const RatioSlice = z.object({
  count: z.number(),
  percentage: numeric,
  unit: z.string().optional(),
});

// ── 1. Appointment summary ──────────────────────────────────────────────
export const AppointmentSummaryOutputSchema = z.object({
  total: z.number(),
  completionRate: z.object({ value: z.number(), unit: z.string() }),
  statusBreakdown: z.array(
    z.object({ status: z.string(), count: z.number(), percentage: numeric }),
  ),
  visitTypeMix: z.object({ exam: CountPct, followUp: CountPct }),
  sessionTypeMix: z.object({ online: CountPct, inClinic: CountPct }),
  walkInVsScheduled: z.object({ walkIn: CountPct, scheduled: CountPct }),
  firstVisitVsReturning: z.object({
    firstVisit: CountPct,
    returning: CountPct,
  }),
  billableShare: CountPct,
  avgPerDay: z.number(),
  dailyOverview: z.array(
    z.object({ date: z.string(), day: z.string(), count: z.number() }),
  ),
});

// ── 2. Cancellation & no-show ───────────────────────────────────────────
export const CancellationStatsOutputSchema = z.object({
  noShowRate: z.object({
    value: z.number(),
    change: z.number().optional(),
    trend: z.string().optional(),
    unit: z.string(),
  }),
  cancellationRate: z.object({
    value: numeric,
    count: z.number(),
    total: z.number(),
    unit: z.string(),
  }),
  reasonBreakdown: z.array(
    z.object({ reason: z.string(), count: z.number(), percentage: numeric }),
  ),
  leadTime: z.object({ lastMinute: CountPct, early: CountPct }),
  rescheduleRate: z.object({ value: numeric, unit: z.string() }),
});

// ── 3. Patient summary ──────────────────────────────────────────────────
export const PatientSummaryOutputSchema = z.object({
  patients: z.object({
    total: z.number(),
    active: RatioSlice,
    inactive: RatioSlice,
  }),
  newPatients: z.object({
    count: z.number(),
    change: z.number(),
    trend: z.string(),
    previous: z.number(),
  }),
  newVsReturning: z.object({ new: CountPct, returning: CountPct }),
  ageDistribution: z.object({
    total: z.number(),
    ranges: z.array(
      z.object({
        range: z.string(),
        count: z.number(),
        percentage: numeric,
        unit: z.string().optional(),
      }),
    ),
  }),
  genderDistribution: z.object({
    total: z.number(),
    male: RatioSlice,
    female: RatioSlice,
  }),
  byProtocol: z.object({
    total: z.number(),
    protocols: z.array(
      z.object({
        protocol: z.string(),
        count: z.number(),
        percentage: numeric,
        unit: z.string().optional(),
      }),
    ),
  }),
});

// ── 4. Doctor performance ───────────────────────────────────────────────
export const DoctorPerformanceOutputSchema = z.object({
  doctors: z.array(
    z.object({
      doctorId: z.string(),
      name: z.string().nullable(),
      email: z.string().nullable(),
      specialty: z.string().nullable(),
      booked: z.number(),
      completed: z.number(),
      noShow: z.number(),
      cancelled: z.number(),
      uniquePatients: z.number(),
      completionRate: z.number(),
      noShowRate: z.number(),
      cancelRate: z.number(),
      revenue: z.number(),
    }),
  ),
});

// ── 5. Financial summary ────────────────────────────────────────────────
export const FinancialSummaryOutputSchema = z.object({
  totalRevenue: z.number(),
  outstandingBalance: z.number(),
  requiredAmount: z.number(),
  collectionRate: z.object({ value: numeric, unit: z.string() }),
  totalDiscount: z.number(),
  paymentsCount: z.number(),
  payingPatients: z.number(),
  avgRevenuePerPayment: z.number(),
  byMethod: z.array(
    z.object({ method: z.string(), total: z.number(), count: z.number() }),
  ),
  byService: z.array(
    z.object({
      service: z.string().nullable(),
      revenue: z.number(),
      count: z.number(),
    }),
  ),
});

// ── 6. Operational stats ────────────────────────────────────────────────
export const OperationalStatsOutputSchema = z.object({
  peakDay: z.string().nullable(),
  peakHours: z.array(z.object({ hour: z.number(), count: z.number() })),
  avgWaitTimeMinutes: z.number(),
  avgConsultationMinutes: z.number(),
  consultationsSampled: z.number(),
  slotUtilization: z.object({
    value: numeric,
    unit: z.string(),
    bookedMinutes: z.number(),
    availableMinutes: z.number(),
    basis: z.string(),
  }),
  staffAttendance: z.record(z.string(), z.unknown()),
});

// ── 7. Service / specialty stats ────────────────────────────────────────
export const ServiceStatsOutputSchema = z.object({
  popularServices: z.array(
    z.object({ service: z.string(), count: z.number(), percentage: numeric }),
  ),
  revenuePerService: z.array(
    z.object({ service: z.string().nullable(), revenue: z.number() }),
  ),
  appointmentsBySpecialty: z.array(
    z.object({ specialty: z.string(), count: z.number() }),
  ),
});

// ── 8. Growth trends ────────────────────────────────────────────────────
const GrowthMetric = z.object({
  current: z.number(),
  previous: z.number(),
  changePercent: z.number().nullable(),
  trend: z.string(),
});

export const GrowthTrendsOutputSchema = z.object({
  appointmentVolume: GrowthMetric,
  newPatients: GrowthMetric,
  revenue: GrowthMetric,
});

export type AppointmentSummaryOutput = z.infer<
  typeof AppointmentSummaryOutputSchema
>;
export type CancellationStatsOutput = z.infer<
  typeof CancellationStatsOutputSchema
>;
export type PatientSummaryOutput = z.infer<typeof PatientSummaryOutputSchema>;
export type DoctorPerformanceOutput = z.infer<
  typeof DoctorPerformanceOutputSchema
>;
export type FinancialSummaryOutput = z.infer<
  typeof FinancialSummaryOutputSchema
>;
export type OperationalStatsOutput = z.infer<
  typeof OperationalStatsOutputSchema
>;
export type ServiceStatsOutput = z.infer<typeof ServiceStatsOutputSchema>;
export type GrowthTrendsOutput = z.infer<typeof GrowthTrendsOutputSchema>;
