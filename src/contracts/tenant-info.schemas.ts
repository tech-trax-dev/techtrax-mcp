import { z } from 'zod';

/**
 * Protocol-level output contracts for every `tenant_info.*` tool.
 *
 * These Zod schemas are attached to each `@Tool({ outputSchema })` so the MCP
 * `tools/list` advertises the exact shape a tool returns and clients can rely on
 * `structuredContent`. They mirror the payloads produced by the TechTrax backend
 * `mcpTenantInfo.service.js`. Fields that the backend may omit are `.nullable()`.
 */

export const ClinicOperatingHourSchema = z.object({
  day: z.string(),
  openTime: z.string().nullable(),
  closeTime: z.string().nullable(),
  isWorkingDay: z.boolean(),
});

export const ClinicCurrentStatusSchema = z.enum([
  'open_now',
  'closed_now',
  'closed_today',
]);

/** Output of `tenant_info.get_clinic_profile`. */
export const ClinicProfileOutputSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  logoUrl: z.string().nullable(),
  primaryPhone: z.string().nullable(),
  secondaryPhone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  specialties: z.array(z.string()),
  timezone: z.string(),
  operatingHours: z.array(ClinicOperatingHourSchema),
  currentStatus: ClinicCurrentStatusSchema,
});

/**
 * Output of a clinic status check (the live open/closed signal).
 *
 * NOTE: there is currently no `tenant_info.get_clinic_status` tool — the live
 * status is exposed through `currentStatus` on `get_clinic_profile`. This schema
 * is exported so the contract is ready to attach the day a dedicated status tool
 * is added.
 */
export const ClinicStatusOutputSchema = z.object({
  name: z.string(),
  timezone: z.string(),
  currentStatus: ClinicCurrentStatusSchema,
});

export const DoctorListItemSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  specialty: z.string().nullable(),
  bio: z.string().nullable(),
  presenceStatus: z.enum(['present', 'absent']),
  supportsOnline: z.boolean(),
  supportsOffline: z.boolean(),
});

export const DoctorsListPaginationSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total_count: z.number(),
  has_more: z.boolean(),
  next_page: z.number().nullable(),
});

/** Output of `tenant_info.list_doctors`. */
export const DoctorsListOutputSchema = z.object({
  doctors: z.array(DoctorListItemSchema),
  pagination: DoctorsListPaginationSchema,
});

export const DoctorEducationSchema = z.object({
  university: z.string().nullable(),
  faculty: z.string().nullable(),
  major: z.string().nullable(),
  graduationYear: z.number().nullable(),
  degree: z.string().nullable(),
  level: z.string().nullable(),
});

export const DoctorCertificationSchema = z.object({
  certificationName: z.string().nullable(),
  year: z.number().nullable(),
});

export const DoctorExperienceSchema = z
  .enum(['0-2', '3-5', '6-8', '9-10', '10+'])
  .nullable();

/** Output of `tenant_info.get_doctor_profile`. */
export const DoctorProfileOutputSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  specialty: z.string().nullable(),
  bio: z.string().nullable(),
  education: DoctorEducationSchema,
  certifications: z.array(DoctorCertificationSchema),
  experience: DoctorExperienceSchema,
});

export const DoctorScheduleEntrySchema = z.object({
  day: z.string(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  mode: z.enum(['online', 'offline', 'both']),
});

/** Output of `tenant_info.get_doctor_availability`. */
export const DoctorAvailabilityOutputSchema = z.object({
  available: z.boolean(),
  reason: z.enum(['absent', 'no_shift_today']).nullable(),
  availableOnline: z.boolean(),
  availableOffline: z.boolean(),
  schedule: z.array(DoctorScheduleEntrySchema),
});

export type ClinicProfileOutput = z.infer<typeof ClinicProfileOutputSchema>;
export type ClinicStatusOutput = z.infer<typeof ClinicStatusOutputSchema>;
export type DoctorsListOutput = z.infer<typeof DoctorsListOutputSchema>;
export type DoctorProfileOutput = z.infer<typeof DoctorProfileOutputSchema>;
export type DoctorAvailabilityOutput = z.infer<
  typeof DoctorAvailabilityOutputSchema
>;
