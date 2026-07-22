import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { BackendHttpService } from '../../common/backend/backend-http.service';
import { BackendException } from '../../common/errors/backend.exception';
import { errorResult } from '../../common/mcp/tool-response.util';
import type { McpToolResult } from '../../common/mcp/tool-response.util';
import {
  resolveTenantId,
  missingTenant,
  tenantIdParam,
} from '../../common/mcp/tenant.util';
import type { ToolRequest } from '../../common/mcp/tenant.util';
import { RequireCapability } from '../../common/mcp/tool-authorization.guard';
import {
  TeamsListOutputSchema,
  TeamDetailOutputSchema,
  LeadAssignmentOutputSchema,
} from '../../contracts/crm.schemas';
import type {
  TeamsListOutput,
  TeamDetailOutput,
  LeadAssignmentOutput,
} from '../../contracts/crm.schemas';

type OutputFormat = 'json' | 'markdown';

const formatSchema = z.enum(['json', 'markdown']).default('json');

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

// Reassigning a lead changes ownership; it's a write, not destructive, and not
// safe to blindly auto-retry (it re-fires assignment notifications).
const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

/**
 * CRM lead-assignment tools. Intended flow for the AI:
 *   1. crm.list_teams  → read each team's name + description, pick the team that
 *      best matches the lead's conversation.
 *   2. crm.get_team    → get that team's teamLead + members (ids + roles).
 *   3. crm.assign_lead → assign the existing lead to the chosen member or lead.
 */
@Injectable()
export class CrmTools {
  constructor(private readonly backend: BackendHttpService) {}

  @Tool({
    name: 'crm.list_teams',
    description:
      "Lists the workspace's teams so you can route a lead to the right one. Returns per team: id, name, description (what the team handles — use this + the team name to match the lead's conversation), memberCount, teamLeadName, status, isSystemReserved. Step 1 of assigning a lead: read the descriptions, pick the best-fit team, then call crm.get_team for its members. Paginated (read pagination.pages). Note: the system-reserved 'Unassigned' team (isSystemReserved=true) is the no-owner bucket — don't assign real leads to it.",
    parameters: z.object({
      tenantId: tenantIdParam,
      status: z
        .enum(['active', 'archived'])
        .optional()
        .describe('Filter by team status. Defaults to active.'),
      search: z.string().min(1).optional().describe('Filter teams by name.'),
      page: z.number().int().positive().optional(),
      limit: z.number().int().positive().max(100).optional(),
      format: formatSchema.optional(),
    }),
    outputSchema: TeamsListOutputSchema,
    annotations: READ_ANNOTATIONS,
  })
  @RequireCapability('lead:read')
  async listTeams(
    args: {
      tenantId?: string;
      status?: 'active' | 'archived';
      search?: string;
      page?: number;
      limit?: number;
      format?: OutputFormat;
    },
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    const format = args.format ?? 'json';
    const tenantId = resolveTenantId(request, args);
    if (!tenantId) return missingTenant();

    try {
      const data = await this.getWithTenantHeader<TeamsListOutput>(
        tenantId,
        '/api/v1/mcp/crm/teams',
        {
          params: {
            status: args.status,
            search: args.search,
            page: args.page,
            limit: args.limit,
          },
        },
      );
      return this.formatResult(data, format, (p) => this.renderTeams(p));
    } catch (e) {
      return errorResult(`Failed to list teams: ${(e as Error).message}`);
    }
  }

  @Tool({
    name: 'crm.get_team',
    description:
      "Returns one team's teamLead and members (each with id, name, roleName) plus its description and memberCount. Step 2 of assigning a lead: after picking a team with crm.list_teams, call this to get the member/lead ids, then choose who should own the lead and pass their id as assignedTo to crm.assign_lead. `teamLead` may be null (team with no designated lead).",
    parameters: z.object({
      tenantId: tenantIdParam,
      teamId: z.string().min(1),
      format: formatSchema.optional(),
    }),
    outputSchema: TeamDetailOutputSchema,
    annotations: READ_ANNOTATIONS,
  })
  @RequireCapability('lead:read')
  async getTeam(
    args: { tenantId?: string; teamId: string; format?: OutputFormat },
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    const format = args.format ?? 'json';
    const tenantId = resolveTenantId(request, args);
    if (!tenantId) return missingTenant();

    try {
      const data = await this.getWithTenantHeader<TeamDetailOutput>(
        tenantId,
        `/api/v1/mcp/crm/teams/${encodeURIComponent(args.teamId)}`,
      );
      return this.formatResult(data, format, (p) => this.renderTeam(p));
    } catch (e) {
      if (e instanceof BackendException && e.status === 404) {
        return errorResult(
          'Team not found. Use crm.list_teams to get valid team ids.',
        );
      }
      return errorResult(`Failed to fetch team: ${(e as Error).message}`);
    }
  }

  @Tool({
    name: 'crm.assign_lead',
    description:
      "Assigns an EXISTING lead to an owner. It does NOT create a lead; it re-owns `leadId` and notifies the new owner. There are THREE ways to choose the owner (decide from the lead's conversation + the teams' names/descriptions):\n" +
      '1. Specific person — pass `assignedTo` (a teamLead._id or members[]._id from crm.get_team). Use when the conversation points to one person. `teamId` is optional here (but if given, the user must belong to it).\n' +
      "2. Team lead — pass `teamId` only (no `assignedTo`, no `isRoundRobin`). The lead goes to that team's designated team lead.\n" +
      "3. Auto / round-robin — pass `teamId` + `isRoundRobin: true`. The backend fairly distributes across the team's MEMBERS (team lead excluded), load-aware: it picks whoever currently has the fewest open leads. Use when you just want the right TEAM to handle it and don't need a specific person.\n" +
      'Rules: give `assignedTo` or `teamId` (at least one). `assignedTo` + `isRoundRobin` together is rejected. The chosen user must be an active, non-admin member (the backend validates). Returns the updated lead with its resolved assignedTo.',
    parameters: z.object({
      tenantId: tenantIdParam,
      leadId: z
        .string()
        .min(1)
        .describe('The id of the existing lead (CustomerProfile) to assign.'),
      assignedTo: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Method 1/2: a specific owner's user id — a teamLead._id or members[]._id from crm.get_team. Omit to assign by team (lead or round-robin).",
        ),
      teamId: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Method 2/3: the team to route to. Alone → the team lead. With isRoundRobin → round-robin across members.',
        ),
      isRoundRobin: z
        .boolean()
        .optional()
        .describe(
          'Method 3: with teamId, auto-distribute to the least-loaded team member (team lead excluded). Cannot be combined with assignedTo.',
        ),
      actorUserId: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Optional: the user id to attribute this assignment to (who performed it).',
        ),
      format: formatSchema.optional(),
    }),
    outputSchema: LeadAssignmentOutputSchema,
    annotations: WRITE_ANNOTATIONS,
  })
  @RequireCapability('lead:write')
  async assignLead(
    args: {
      tenantId?: string;
      leadId: string;
      assignedTo?: string;
      teamId?: string;
      isRoundRobin?: boolean;
      actorUserId?: string;
      format?: OutputFormat;
    },
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    const format = args.format ?? 'json';
    const tenantId = resolveTenantId(request, args);
    if (!tenantId) return missingTenant();

    if (!args.assignedTo && !args.teamId) {
      return errorResult(
        'Provide assignedTo (a specific user), or teamId (alone for the team lead, or with isRoundRobin for round-robin).',
      );
    }
    if (args.assignedTo && args.isRoundRobin) {
      return errorResult(
        'assignedTo and isRoundRobin are mutually exclusive — pass a specific user, or a team to round-robin across.',
      );
    }

    try {
      const data = await this.postWithTenantHeader<LeadAssignmentOutput>(
        tenantId,
        `/api/v1/mcp/crm/leads/${encodeURIComponent(args.leadId)}/assign`,
        {
          assignedTo: args.assignedTo,
          teamId: args.teamId,
          isRoundRobin: args.isRoundRobin,
          actorUserId: args.actorUserId,
        },
      );
      return this.formatResult(data, format, (p) => this.renderLead(p));
    } catch (e) {
      if (e instanceof BackendException && e.status === 404) {
        return errorResult('Lead not found.');
      }
      return errorResult(`Failed to assign lead: ${(e as Error).message}`);
    }
  }

  // ======================== Helpers ========================

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

  private formatResult<T>(
    data: T,
    format: OutputFormat,
    markdownFormatter: (payload: T) => string,
  ): McpToolResult {
    const text =
      format === 'markdown'
        ? markdownFormatter(data)
        : JSON.stringify(data, null, 2);
    return { content: [{ type: 'text', text }], structuredContent: data };
  }

  private renderTeams(data: TeamsListOutput): string {
    const lines = data.teams.map(
      (t) =>
        `- **${t.name}** (${t.id})${t.isSystemReserved ? ' _[system: Unassigned]_' : ''} — ${t.description || 'no description'} · members: ${t.memberCount} · lead: ${t.teamLeadName ?? 'none'}`,
    );
    return ['# Teams', '', ...lines].join('\n');
  }

  private renderTeam(data: TeamDetailOutput): string {
    const members =
      data.members.length > 0
        ? data.members.map(
            (m) => `  - ${m.name ?? m.id} (${m.id}) — ${m.roleName ?? 'N/A'}`,
          )
        : ['  - (no members)'];
    return [
      `# ${data.name} (${data.id})`,
      '',
      `- **Description:** ${data.description || 'N/A'}`,
      `- **Team lead:** ${data.teamLead ? `${data.teamLead.name} (${data.teamLead.id})` : 'none'}`,
      '- **Members:**',
      ...members,
    ].join('\n');
  }

  private renderLead(data: LeadAssignmentOutput): string {
    const name =
      `${data.firstName ?? ''} ${data.lastName ?? ''}`.trim() || data.id;
    return [
      '# Lead assigned',
      '',
      `- **Lead:** ${name} (${data.id})`,
      `- **Assigned to:** ${data.assignedTo ?? 'unassigned'}`,
      `- **Status:** ${data.status ?? 'N/A'}`,
      `- **Assigned at:** ${data.assignedAt ?? 'N/A'}`,
    ].join('\n');
  }
}
