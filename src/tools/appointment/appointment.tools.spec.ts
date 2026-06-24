import 'reflect-metadata';
import type { z } from 'zod';
import { BackendException } from '../../common/errors/backend.exception';
import {
  AppointmentOutputSchema,
  AppointmentsListOutputSchema,
  AvailableSlotsOutputSchema,
  PatientsListOutputSchema,
} from '../../contracts/appointment.schemas';
import { AppointmentTools } from './appointment.tools';

const TOOL_METADATA_KEY = 'mcp:tool';

type ToolMetadata = {
  name: string;
  description: string;
  parameters?: z.ZodType;
  outputSchema?: z.ZodType;
  annotations?: Record<string, unknown>;
};

const getToolMetadata = (
  methodName: keyof typeof AppointmentTools.prototype,
): ToolMetadata => {
  const method = (
    AppointmentTools.prototype as unknown as Record<string, object>
  )[methodName];
  return Reflect.getMetadata(TOOL_METADATA_KEY, method) as ToolMetadata;
};

const request = { user: { tenantId: '64b7f0000000000000000001' } };

const pagination = {
  page: 1,
  limit: 10,
  total: 0,
  totalPages: 0,
  hasMore: false,
  nextPage: null,
};

const emptyPatients = { patients: [], pagination };

const slotsResponse = {
  doctorId: 'doc1',
  date: '2026-07-01',
  granularity: 'slots' as const,
  slots: ['2026-07-01T09:00:00.000Z', '2026-07-01T09:30:00.000Z'],
};

const appointmentResponse = {
  id: 'appt1',
  patientId: 'pat1',
  patientName: 'John Roe',
  doctorId: 'doc1',
  doctorName: 'Jane Doe',
  appointmentDateTime: '2026-07-01T09:00:00.000Z',
  appointmentEndTime: '2026-07-01T09:20:00.000Z',
  sessionType: 'on-site',
  visitType: 'follow-up',
  status: 'upcoming',
  duration: 20,
  cancelReason: null,
  cancelNote: null,
};

const appointmentsListResponse = {
  appointments: [appointmentResponse],
  pagination: { ...pagination, total: 1, totalPages: 1 },
};

describe('AppointmentTools', () => {
  let backend: { get: jest.Mock; post: jest.Mock; patch: jest.Mock };
  let tools: AppointmentTools;

  beforeEach(() => {
    backend = { get: jest.fn(), post: jest.fn(), patch: jest.fn() };
    tools = new AppointmentTools(backend as never);
  });

  describe('reads', () => {
    it('find_patient: empty result is a success, schema-valid', async () => {
      backend.get.mockResolvedValue(emptyPatients);
      const result = await tools.findPatient(
        { query: 'nobody' },
        undefined,
        request,
      );
      expect(result.isError).toBeFalsy();
      expect(() =>
        PatientsListOutputSchema.parse(result.structuredContent),
      ).not.toThrow();
    });

    it('get_available_slots: returns schema-valid structuredContent', async () => {
      backend.get.mockResolvedValue(slotsResponse);
      const result = await tools.getAvailableSlots(
        { doctorId: 'doc1', date: '2026-07-01' },
        undefined,
        request,
      );
      expect(() =>
        AvailableSlotsOutputSchema.parse(result.structuredContent),
      ).not.toThrow();
    });

    it('list_appointments: returns schema-valid structuredContent', async () => {
      backend.get.mockResolvedValue(appointmentsListResponse);
      const result = await tools.listAppointments({}, undefined, request);
      expect(() =>
        AppointmentsListOutputSchema.parse(result.structuredContent),
      ).not.toThrow();
    });

    it('get_appointment: 404 surfaces as a readable isError', async () => {
      backend.get.mockRejectedValue(new BackendException(404, 'nope'));
      const result = await tools.getAppointment(
        { appointmentId: 'missing' },
        undefined,
        request,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });
  });

  describe('writes', () => {
    it('book: POSTs to /book and returns the created appointment', async () => {
      backend.post.mockResolvedValue(appointmentResponse);
      const result = await tools.book(
        {
          patientId: 'pat1',
          doctorId: 'doc1',
          appointmentDateTime: '2026-07-01T09:00:00.000Z',
          sessionType: 'on-site',
        },
        undefined,
        request,
      );
      expect(backend.post).toHaveBeenCalledWith(
        '/api/v1/mcp/appointments/book',
        expect.objectContaining({ patientId: 'pat1', doctorId: 'doc1' }),
        { headers: { 'x-tenant-id': request.user.tenantId } },
      );
      expect(() =>
        AppointmentOutputSchema.parse(result.structuredContent),
      ).not.toThrow();
    });

    it('book: backend validation error becomes a readable isError', async () => {
      backend.post.mockRejectedValue(
        new BackendException(400, 'Overlapping appointment exists'),
      );
      const result = await tools.book(
        {
          patientId: 'pat1',
          doctorId: 'doc1',
          appointmentDateTime: '2026-07-01T09:00:00.000Z',
          sessionType: 'on-site',
        },
        undefined,
        request,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        'Overlapping appointment exists',
      );
    });

    it('reschedule: PATCHes the reschedule endpoint', async () => {
      backend.patch.mockResolvedValue(appointmentResponse);
      await tools.reschedule(
        {
          appointmentId: 'appt1',
          appointmentDateTime: '2026-07-02T10:00:00.000Z',
          sessionType: 'online',
        },
        undefined,
        request,
      );
      expect(backend.patch).toHaveBeenCalledWith(
        '/api/v1/mcp/appointments/appt1/reschedule',
        expect.objectContaining({ sessionType: 'online' }),
        { headers: { 'x-tenant-id': request.user.tenantId } },
      );
    });

    it('cancel: PATCHes the cancel endpoint', async () => {
      backend.patch.mockResolvedValue({
        ...appointmentResponse,
        status: 'cancelled',
      });
      const result = await tools.cancel(
        { appointmentId: 'appt1', cancelReason: 're-schedule' },
        undefined,
        request,
      );
      expect(backend.patch).toHaveBeenCalledWith(
        '/api/v1/mcp/appointments/appt1/cancel',
        expect.objectContaining({ cancelReason: 're-schedule' }),
        { headers: { 'x-tenant-id': request.user.tenantId } },
      );
      expect(result.structuredContent).toMatchObject({ status: 'cancelled' });
    });
  });

  describe('tenant context + annotations', () => {
    it('returns an error when tenant context is missing', async () => {
      const result = await tools.listAppointments({}, undefined, {});
      expect(result.isError).toBe(true);
      expect(backend.get).not.toHaveBeenCalled();
    });

    it('marks cancel as destructive and book/reschedule as non-readonly writes', () => {
      expect(getToolMetadata('cancel').annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
      });
      expect(getToolMetadata('book').annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      });
      expect(getToolMetadata('reschedule').annotations).toMatchObject({
        readOnlyHint: false,
        idempotentHint: false,
      });
    });

    it('declares outputSchema on every appointment tool', () => {
      expect(getToolMetadata('findPatient').outputSchema).toBe(
        PatientsListOutputSchema,
      );
      expect(getToolMetadata('getAvailableSlots').outputSchema).toBe(
        AvailableSlotsOutputSchema,
      );
      expect(getToolMetadata('listAppointments').outputSchema).toBe(
        AppointmentsListOutputSchema,
      );
      expect(getToolMetadata('book').outputSchema).toBe(
        AppointmentOutputSchema,
      );
    });
  });
});
