import { z } from 'zod';

/**
 * Output contracts for the `crm.*` tools (lead assignment). Mirror the flat
 * payloads from the backend MCP CRM endpoints (`/api/v1/mcp/crm/*`). Fields the
 * backend may omit are `.nullable()`.
 */

export const TeamListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  memberCount: z.number(),
  teamLeadName: z.string().nullable(),
  status: z.string().nullable(),
  isSystemReserved: z.boolean(),
});

export const TeamsPaginationSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  pages: z.number(),
});

/** Output of `crm.list_teams`. */
export const TeamsListOutputSchema = z.object({
  teams: z.array(TeamListItemSchema),
  pagination: TeamsPaginationSchema,
});

export const TeamMemberSchema = z.object({
  id: z.string().nullable(),
  name: z.string().nullable(),
  roleName: z.string().nullable(),
});

/** Output of `crm.get_team`. */
export const TeamDetailOutputSchema = z.object({
  id: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  status: z.string().nullable(),
  isSystemReserved: z.boolean(),
  teamLead: TeamMemberSchema.nullable(),
  members: z.array(TeamMemberSchema),
  memberCount: z.number(),
});

/** Output of `crm.assign_lead`. */
export const LeadAssignmentOutputSchema = z.object({
  id: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  assignedTo: z.string().nullable(),
  status: z.string().nullable(),
  assignedAt: z.string().nullable(),
});

export type TeamsListOutput = z.infer<typeof TeamsListOutputSchema>;
export type TeamDetailOutput = z.infer<typeof TeamDetailOutputSchema>;
export type LeadAssignmentOutput = z.infer<typeof LeadAssignmentOutputSchema>;
