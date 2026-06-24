import { z } from 'zod';

/**
 * Protocol-level output contracts for every `appointment.*` tool.
 *
 * Attached to each `@Tool({ outputSchema })` so `tools/list` advertises the exact
 * returned shape and clients can rely on `structuredContent`. They mirror the
 * flat payloads produced by the TechTrax backend `mcpAppointments.service.js`.
 * Fields the backend may omit are `.nullable()`.
 */

export const SESSION_TYPES = ['online', 'on-site'] as const;

/** A single appointment, flattened for MCP consumption. */
export const AppointmentSchema = z.object({
  id: z.string(),
  patientId: z.string().nullable(),
  patientName: z.string().nullable(),
  doctorId: z.string().nullable(),
  doctorName: z.string().nullable(),
  appointmentDateTime: z.string().nullable(),
  appointmentEndTime: z.string().nullable(),
  sessionType: z.string().nullable(),
  visitType: z.string().nullable(),
  status: z.string().nullable(),
  duration: z.number().nullable(),
  cancelReason: z.string().nullable(),
  cancelNote: z.string().nullable(),
});

export const PaginationSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  totalPages: z.number(),
  hasMore: z.boolean(),
  nextPage: z.number().nullable(),
});

/** Output of `appointment.get_available_slots`. */
export const AvailableSlotsOutputSchema = z.object({
  doctorId: z.string(),
  date: z.string().nullable(),
  // 'slots' => `slots` holds ISO datetimes for the requested date.
  // 'dates' => `slots` holds available calendar dates (no specific date asked).
  granularity: z.enum(['slots', 'dates']),
  slots: z.array(z.string()),
});

export const PatientListItemSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});

/** Output of `appointment.find_patient`. */
export const PatientsListOutputSchema = z.object({
  patients: z.array(PatientListItemSchema),
  pagination: PaginationSchema,
});

/** Output of `appointment.list_appointments`. */
export const AppointmentsListOutputSchema = z.object({
  appointments: z.array(AppointmentSchema),
  pagination: PaginationSchema,
});

/** Output of `appointment.get_appointment`, `.book`, `.reschedule`, `.cancel`. */
export const AppointmentOutputSchema = AppointmentSchema;

export type Appointment = z.infer<typeof AppointmentSchema>;
export type AvailableSlotsOutput = z.infer<typeof AvailableSlotsOutputSchema>;
export type PatientsListOutput = z.infer<typeof PatientsListOutputSchema>;
export type AppointmentsListOutput = z.infer<
  typeof AppointmentsListOutputSchema
>;
export type AppointmentOutput = z.infer<typeof AppointmentOutputSchema>;
