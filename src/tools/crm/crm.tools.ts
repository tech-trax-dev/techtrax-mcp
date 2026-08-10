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
  actorRoleParam,
  resolveActorRole,
} from '../../common/mcp/authorization.util';
import type { ActorRole } from '../../common/mcp/authorization.util';
import {
  TeamsListOutputSchema,
  TeamDetailOutputSchema,
  LeadAssignmentOutputSchema,
  ConversationContextOutputSchema,
  LeadHandoffOutputSchema,
} from '../../contracts/crm.schemas';
import type {
  TeamsListOutput,
  TeamDetailOutput,
  LeadAssignmentOutput,
  ConversationContextOutput,
  LeadHandoffOutput,
} from '../../contracts/crm.schemas';

type OutputFormat = 'json' | 'markdown';

const formatSchema = z.enum(['json', 'markdown']).default('json');

const resolveRunHeader = (
  request: ToolRequest | undefined,
  header: string,
  fallback: string,
): string | undefined => {
  const raw = request?.headers?.[header];
  const trusted = Array.isArray(raw) ? raw[0] : raw;
  if (typeof trusted === 'string' && trusted.trim()) return trusted.trim();
  return process.env.NODE_ENV === 'production' ? undefined : fallback;
};

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
 * CRM lead tools. Meta lead agents use the existing conversation lead, inspect
 * teams, assign it with crm.assign_lead, then call
 * meta_leads.qualify_and_handoff after collecting a phone.
 */
@Injectable()
export class CrmTools {
  constructor(private readonly backend: BackendHttpService) {}

  @Tool({
    name: 'crm.get_conversation_context',
    description:
      'Loads the existing Meta lead, current owner, conversation state, channel type, and recent messages in chronological order. Use this before routing a lead. The lead already exists. After collecting a phone and choosing a route, use meta_leads.qualify_and_handoff.',
    parameters: z.object({
      tenantId: tenantIdParam,
      actorRole: actorRoleParam,
      conversationId: z.string().min(1),
      messageLimit: z.number().int().min(1).max(50).default(20).optional(),
      format: formatSchema.optional(),
    }),
    outputSchema: ConversationContextOutputSchema,
    annotations: READ_ANNOTATIONS,
  })
  @RequireCapability('lead:read')
  async getConversationContext(
    args: {
      tenantId?: string;
      actorRole?: ActorRole;
      conversationId: string;
      messageLimit?: number;
      format?: OutputFormat;
    },
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    const tenantId = resolveTenantId(request, args);
    if (!tenantId) return missingTenant();
    const conversationId = resolveRunHeader(
      request,
      'x-conversation-id',
      args.conversationId,
    );
    if (!conversationId) {
      return errorResult('Trusted x-conversation-id header is required.');
    }

    try {
      const data = await this.getWithTenantHeader<ConversationContextOutput>(
        tenantId,
        `/api/v1/mcp/crm/conversations/${encodeURIComponent(conversationId)}/context`,
        { params: { messageLimit: args.messageLimit ?? 20 } },
      );
      const parsed = ConversationContextOutputSchema.parse(data);
      return this.formatResult(parsed, args.format ?? 'json', (payload) =>
        JSON.stringify(payload, null, 2),
      );
    } catch (e) {
      if (e instanceof BackendException && e.status === 404) {
        return errorResult('Conversation not found.');
      }
      return errorResult(
        `Failed to load conversation context: ${(e as Error).message}`,
      );
    }
  }

  @Tool({
    name: 'crm.list_teams',
    description:
      "Lists the workspace's teams so you can route a lead to the right one. Returns per team: id, name, description (what the team handles — use this + the team name to match the lead's conversation), memberCount, teamLeadName, status, isSystemReserved. Step 1 of assigning a lead: read the descriptions, pick the best-fit team, then call crm.get_team for its members. Paginated (read pagination.pages). Note: the system-reserved 'Unassigned' team (isSystemReserved=true) is the no-owner bucket — don't assign real leads to it.",
    parameters: z.object({
      tenantId: tenantIdParam,
      actorRole: actorRoleParam,
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
      actorRole?: ActorRole;
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
      "Returns one team's teamLead and members (each with id, name, roleName) plus its description and memberCount. After picking a team with crm.list_teams, call this to choose who should own the lead, then call crm.assign_lead. `teamLead` may be null (team with no designated lead).",
    parameters: z.object({
      tenantId: tenantIdParam,
      actorRole: actorRoleParam,
      teamId: z.string().min(1),
      format: formatSchema.optional(),
    }),
    outputSchema: TeamDetailOutputSchema,
    annotations: READ_ANNOTATIONS,
  })
  @RequireCapability('lead:read')
  async getTeam(
    args: {
      tenantId?: string;
      actorRole?: ActorRole;
      teamId: string;
      format?: OutputFormat;
    },
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
          'Team not found. Use list_teams to get valid team ids.',
        );
      }
      return errorResult(`Failed to fetch team: ${(e as Error).message}`);
    }
  }

  @Tool({
    name: 'meta_leads.qualify_and_handoff',
    description:
      'Stores the phone from the current inbound message and starts human takeover for an already-assigned Meta lead. Call crm.assign_lead first, then call this tool. It does not select a team or change assignment. The TechTrax backend sends deterministic transition copy after success.',
    parameters: z.object({
      tenantId: tenantIdParam,
      actorRole: actorRoleParam,
      conversationId: z.string().min(1),
      inboundMessageId: z
        .string()
        .min(1)
        .describe('The current inbound message id from agent_metadata.'),
      phone: z
        .string()
        .regex(/^\+?\d{7,16}$/)
        .describe('The phone number explicitly provided by the lead.'),
      format: formatSchema.optional(),
    }),
    outputSchema: LeadHandoffOutputSchema,
    annotations: WRITE_ANNOTATIONS,
  })
  @RequireCapability('lead:handoff')
  async qualifyAndHandoff(
    args: {
      tenantId?: string;
      actorRole?: ActorRole;
      conversationId: string;
      inboundMessageId: string;
      phone: string;
      format?: OutputFormat;
    },
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    const tenantId = resolveTenantId(request, args);
    if (!tenantId) return missingTenant();
    const conversationId = resolveRunHeader(
      request,
      'x-conversation-id',
      args.conversationId,
    );
    const inboundMessageId = resolveRunHeader(
      request,
      'x-inbound-message-id',
      args.inboundMessageId,
    );
    if (!conversationId || !inboundMessageId) {
      return errorResult(
        'Trusted x-conversation-id and x-inbound-message-id headers are required.',
      );
    }
    try {
      const data = await this.postWithTenantHeader<LeadHandoffOutput>(
        tenantId,
        `/api/v1/mcp/crm/conversations/${encodeURIComponent(conversationId)}/qualify-and-handoff`,
        {
          inboundMessageId,
          phone: args.phone,
        },
      );
      const parsed = LeadHandoffOutputSchema.parse(data);
      return this.formatResult(parsed, args.format ?? 'json', (payload) =>
        this.renderHandoff(payload),
      );
    } catch (e) {
      if (e instanceof BackendException && e.status === 404) {
        return errorResult('Conversation or lead not found.');
      }
      return errorResult(`Failed to hand off lead: ${(e as Error).message}`);
    }
  }

  @Tool({
    name: 'crm.assign_lead',
    description:
      "Assigns an EXISTING lead and notifies the new owner. Meta lead agents must call this before meta_leads.qualify_and_handoff. It does NOT create a lead. There are THREE ways to choose the owner (decide from the lead's conversation + the teams' names/descriptions):\n" +
      '1. Specific person — pass `assignedTo` (a teamLead._id or members[]._id from crm.get_team). Use when the conversation points to one person. `teamId` is optional here (but if given, the user must belong to it).\n' +
      "2. Team lead — pass `teamId` only (no `assignedTo`, no `isRoundRobin`). The lead goes to that team's designated team lead.\n" +
      "3. Auto / round-robin — pass `teamId` + `isRoundRobin: true`. The backend fairly distributes across the team's MEMBERS (team lead excluded), load-aware: it picks whoever currently has the fewest open leads. Use when you just want the right TEAM to handle it and don't need a specific person.\n" +
      'Rules: give `assignedTo` or `teamId` (at least one). `assignedTo` + `isRoundRobin` together is rejected. The chosen user must be an active, non-admin member (the backend validates). Returns the updated lead with its resolved assignedTo.',
    parameters: z.object({
      tenantId: tenantIdParam,
      actorRole: actorRoleParam,
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
  @RequireCapability('lead:assign')
  async assignLead(
    args: {
      tenantId?: string;
      actorRole?: ActorRole;
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
          actorUserId:
            resolveActorRole(request, args) === 'lead_agent'
              ? undefined
              : args.actorUserId,
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

  private renderHandoff(data: LeadHandoffOutput): string {
    return [
      '# Lead ready for human handoff',
      '',
      `- **Lead:** ${data.id}`,
      `- **Phone:** ${data.phone ?? 'N/A'}`,
      `- **Assigned to:** ${data.assignedTo ?? 'unassigned'}`,
      `- **Handoff:** ${data.handoffStatus}`,
      '',
      'Tell the customer to send their next message for the assigned sales representative.',
    ].join('\n');
  }
}
