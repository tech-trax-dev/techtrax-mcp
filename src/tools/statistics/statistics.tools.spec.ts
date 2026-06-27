import 'reflect-metadata';
import type { z } from 'zod';
import { BackendException } from '../../common/errors/backend.exception';
import {
  AppointmentSummaryOutputSchema,
  CancellationStatsOutputSchema,
  FinancialSummaryOutputSchema,
  GrowthTrendsOutputSchema,
} from '../../contracts/statistics.schemas';
import { StatisticsTools } from './statistics.tools';

const TOOL_METADATA_KEY = 'mcp:tool';

type ToolMetadata = {
  name: string;
  description: string;
  parameters?: z.ZodType;
  outputSchema?: z.ZodType;
  annotations?: Record<string, unknown>;
};

const getToolMetadata = (
  methodName: keyof typeof StatisticsTools.prototype,
): ToolMetadata => {
  const method = (
    StatisticsTools.prototype as unknown as Record<string, object>
  )[methodName];
  return Reflect.getMetadata(TOOL_METADATA_KEY, method) as ToolMetadata;
};

const request = { user: { tenantId: '64b7f0000000000000000001' } };

const appointmentSummary = {
  total: 12,
  completionRate: { value: 75, unit: '%' },
  statusBreakdown: [{ status: 'completed', count: 9, percentage: 75 }],
  visitTypeMix: {
    exam: { count: 8, percentage: 66.7 },
    followUp: { count: 4, percentage: 33.3 },
  },
  sessionTypeMix: {
    online: { count: 3, percentage: 25 },
    inClinic: { count: 9, percentage: 75 },
  },
  walkInVsScheduled: {
    walkIn: { count: 2, percentage: 16.7 },
    scheduled: { count: 10, percentage: 83.3 },
  },
  firstVisitVsReturning: {
    firstVisit: { count: 5, percentage: 41.7 },
    returning: { count: 7, percentage: 58.3 },
  },
  billableShare: { count: 6, percentage: 50 },
  avgPerDay: 1.7,
  dailyOverview: [{ date: '2026-06-20', day: 'Saturday', count: 4 }],
};

// Mirrors the reused dashboard helper that emits `percentage` as a string.
const cancellationStats = {
  noShowRate: { value: 8, change: -2, trend: 'down', unit: '%' },
  cancellationRate: { value: 10, count: 3, total: 30, unit: '%' },
  reasonBreakdown: [{ reason: 're-schedule', count: 2, percentage: '66.7' }],
  leadTime: {
    lastMinute: { count: 1, percentage: 33.3 },
    early: { count: 2, percentage: 66.7 },
  },
  rescheduleRate: { value: '6.7', unit: '%' },
};

const financialSummary = {
  totalRevenue: 5400,
  outstandingBalance: 800,
  requiredAmount: 6200,
  collectionRate: { value: 87.1, unit: '%' },
  totalDiscount: 150,
  paymentsCount: 22,
  payingPatients: 18,
  avgRevenuePerPayment: 245.45,
  byMethod: [{ method: 'cash', total: 3000, count: 12 }],
  byService: [{ service: 'Consultation', revenue: 4000, count: 20 }],
};

const growthTrends = {
  appointmentVolume: {
    current: 30,
    previous: 24,
    changePercent: 25,
    trend: 'up',
  },
  newPatients: { current: 5, previous: 8, changePercent: -37.5, trend: 'down' },
  revenue: {
    current: 5400,
    previous: 5400,
    changePercent: 0,
    trend: 'neutral',
  },
};

describe('StatisticsTools', () => {
  let backend: { get: jest.Mock };
  let tools: StatisticsTools;

  beforeEach(() => {
    backend = { get: jest.fn() };
    tools = new StatisticsTools(backend as never);
  });

  describe('reads', () => {
    it('get_appointment_summary: forwards tenant header + range, schema-valid', async () => {
      backend.get.mockResolvedValue(appointmentSummary);
      const result = await tools.getAppointmentSummary(
        { from: '2026-06-18', to: '2026-06-24' },
        undefined,
        request,
      );
      expect(backend.get).toHaveBeenCalledWith(
        '/api/v1/mcp/statistics/appointment-summary',
        {
          params: {
            from: '2026-06-18',
            to: '2026-06-24',
            timezone: undefined,
          },
          headers: { 'x-tenant-id': request.user.tenantId },
        },
      );
      expect(result.isError).toBeFalsy();
      expect(() =>
        AppointmentSummaryOutputSchema.parse(result.structuredContent),
      ).not.toThrow();
    });

    it('get_cancellation_stats: tolerates stringified percentages from reused helpers', async () => {
      backend.get.mockResolvedValue(cancellationStats);
      const result = await tools.getCancellationStats({}, undefined, request);
      expect(() =>
        CancellationStatsOutputSchema.parse(result.structuredContent),
      ).not.toThrow();
    });

    it('get_financial_summary: returns schema-valid structuredContent', async () => {
      backend.get.mockResolvedValue(financialSummary);
      const result = await tools.getFinancialSummary({}, undefined, request);
      expect(() =>
        FinancialSummaryOutputSchema.parse(result.structuredContent),
      ).not.toThrow();
    });

    it('get_growth_trends: markdown format renders a readable summary', async () => {
      backend.get.mockResolvedValue(growthTrends);
      const result = await tools.getGrowthTrends(
        { format: 'markdown' },
        undefined,
        request,
      );
      expect(() =>
        GrowthTrendsOutputSchema.parse(result.structuredContent),
      ).not.toThrow();
      expect(result.content[0].text).toContain('# Growth Trends');
      expect(result.content[0].text).toContain('Appointments');
    });

    it('backend failure becomes a readable isError, not a throw', async () => {
      backend.get.mockRejectedValue(new BackendException(502, 'backend down'));
      const result = await tools.getDoctorPerformance({}, undefined, request);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('backend down');
    });
  });

  describe('tenant context + annotations', () => {
    it('returns an error when tenant context is missing', async () => {
      const result = await tools.getAppointmentSummary({}, undefined, {});
      expect(result.isError).toBe(true);
      expect(backend.get).not.toHaveBeenCalled();
    });

    it('marks every statistics tool read-only and idempotent', () => {
      const methods: (keyof typeof StatisticsTools.prototype)[] = [
        'getAppointmentSummary',
        'getCancellationStats',
        'getPatientSummary',
        'getDoctorPerformance',
        'getFinancialSummary',
        'getOperationalStats',
        'getServiceStats',
        'getGrowthTrends',
      ];
      for (const m of methods) {
        expect(getToolMetadata(m).annotations).toMatchObject({
          readOnlyHint: true,
          idempotentHint: true,
        });
        expect(getToolMetadata(m).outputSchema).toBeDefined();
        expect(getToolMetadata(m).name).toMatch(/^statistics\./);
      }
    });
  });
});
