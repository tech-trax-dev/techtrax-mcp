import 'reflect-metadata';
import { BackendException } from '../../common/errors/backend.exception';
import {
  TeamsListOutputSchema,
  TeamDetailOutputSchema,
  LeadAssignmentOutputSchema,
  ConversationContextOutputSchema,
  LeadHandoffOutputSchema,
} from '../../contracts/crm.schemas';
import { CrmTools } from './crm.tools';

const TENANT = 'a'.repeat(24);
const req = { user: { tenantId: TENANT } };

describe('CrmTools', () => {
  let backend: { get: jest.Mock; post: jest.Mock };
  let tools: CrmTools;

  beforeEach(() => {
    backend = { get: jest.fn(), post: jest.fn() };
    tools = new CrmTools(backend as never);
  });

  it('exposes Meta lead routing tools under the Meta leads namespace', () => {
    const prototype = CrmTools.prototype as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    const toolName = (method: string) => {
      const handler = prototype[method];
      if (!handler) return undefined;
      const metadata = Reflect.getMetadata('mcp:tool', handler) as
        | { name?: unknown }
        | undefined;
      return typeof metadata?.name === 'string' ? metadata.name : undefined;
    };

    expect(toolName('getConversationContext')).toBe(
      'crm.get_conversation_context',
    );
    expect(toolName('qualifyAndHandoff')).toBe(
      'meta_leads.qualify_and_handoff',
    );

    expect(toolName('listTeams')).toBe('crm.list_teams');
    expect(toolName('getTeam')).toBe('crm.get_team');
    expect(toolName('listMetaLeadTeams')).toBe('meta_leads.list_teams');
    expect(toolName('getMetaLeadTeam')).toBe('meta_leads.get_team');
    expect(toolName('createLead')).toBeUndefined();
  });

  describe('get_conversation_context', () => {
    it('loads schema-valid context with the tenant tool argument', async () => {
      const payload = {
        conversation: {
          id: 'conversation1',
          status: 'active',
          language: 'ar',
          intent: 'pricing',
          tags: ['hot'],
          priority: 'high',
          aiPausedAt: null,
        },
        lead: {
          id: 'lead1',
          firstName: 'Mona',
          lastName: 'Ali',
          phone: '+201000000000',
          email: null,
          status: 'new',
        },
        assignment: { assignedTo: null },
        channel: { id: 'channel1', type: 'facebook_messenger' },
        messages: [
          {
            messageId: 'message1',
            direction: 'inbound',
            senderType: 'contact',
            messageType: 'text',
            body: 'Hello',
            sentAt: '2026-08-09T10:00:00.000Z',
            aiReply: { content: 'must be stripped' },
          },
        ],
        internalDebug: 'must be stripped',
      };
      backend.get.mockResolvedValue(payload);

      const result = await tools.getConversationContext(
        {
          tenantId: 'b'.repeat(24),
          actorRole: 'admin',
          conversationId: 'conversation1',
          messageLimit: 25,
        },
        undefined,
        {
          headers: { 'x-actor-role': 'lead_agent' },
        },
      );

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).not.toHaveProperty('internalDebug');
      expect(
        (result.structuredContent as { messages: unknown[] }).messages[0],
      ).not.toHaveProperty('aiReply');
      expect(() =>
        ConversationContextOutputSchema.parse(result.structuredContent),
      ).not.toThrow();
      expect(backend.get).toHaveBeenCalledWith(
        '/api/v1/mcp/crm/conversations/conversation1/context',
        {
          params: { messageLimit: 25 },
          headers: { 'x-tenant-id': 'b'.repeat(24) },
        },
      );
    });
  });

  describe('list_teams', () => {
    it('returns schema-valid teams', async () => {
      const payload = {
        teams: [
          {
            id: 't1',
            name: 'Sales-East',
            description: 'Handles east-region enterprise leads',
            memberCount: 3,
            teamLeadName: 'Alice Adams',
            status: 'active',
            isSystemReserved: false,
          },
        ],
        pagination: { page: 1, limit: 100, total: 1, pages: 1 },
      };
      backend.get.mockResolvedValue(payload);

      const result = await tools.listTeams(
        { tenantId: TENANT, actorRole: 'admin' },
        undefined,
        req,
      );

      expect(result.isError).toBeFalsy();
      expect(() =>
        TeamsListOutputSchema.parse(result.structuredContent),
      ).not.toThrow();
    });

    it('errors when tenant is missing', async () => {
      const result = await tools.listTeams(
        { actorRole: 'admin' },
        undefined,
        {},
      );
      expect(result.isError).toBe(true);
      expect(backend.get).not.toHaveBeenCalled();
    });
  });

  describe('get_team', () => {
    it('returns schema-valid team detail', async () => {
      const payload = {
        id: 't1',
        name: 'Sales-East',
        description: 'east region',
        status: 'active',
        isSystemReserved: false,
        teamLead: { id: 'u1', name: 'Alice Adams', roleName: 'Team Lead' },
        members: [{ id: 'u2', name: 'Bob Brown', roleName: 'Sales Rep' }],
        memberCount: 1,
      };
      backend.get.mockResolvedValue(payload);

      const result = await tools.getTeam(
        { tenantId: TENANT, actorRole: 'admin', teamId: 't1' },
        undefined,
        req,
      );

      expect(result.isError).toBeFalsy();
      expect(() =>
        TeamDetailOutputSchema.parse(result.structuredContent),
      ).not.toThrow();
    });

    it('maps a 404 to a friendly error', async () => {
      backend.get.mockRejectedValue(new BackendException(404, 'not found'));
      const result = await tools.getTeam(
        { tenantId: TENANT, actorRole: 'admin', teamId: 'nope' },
        undefined,
        req,
      );
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
    });
  });

  describe('assign_lead', () => {
    const leadPayload = {
      id: 'lead1',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+201012345678',
      email: null,
      assignedTo: 'u2',
      status: 'open',
      assignedAt: '2026-07-22T10:00:00.000Z',
    };

    it('method 1: assigns to a specific user', async () => {
      backend.post.mockResolvedValue(leadPayload);

      const result = await tools.assignLead(
        {
          tenantId: TENANT,
          actorRole: 'admin',
          leadId: 'lead1',
          assignedTo: 'u2',
        },
        undefined,
        req,
      );

      expect(result.isError).toBeFalsy();
      expect(() =>
        LeadAssignmentOutputSchema.parse(result.structuredContent),
      ).not.toThrow();
      expect(backend.post).toHaveBeenCalledWith(
        '/api/v1/mcp/crm/leads/lead1/assign',
        {
          assignedTo: 'u2',
          teamId: undefined,
          isRoundRobin: undefined,
          actorUserId: undefined,
        },
        { headers: { 'x-tenant-id': TENANT } },
      );
    });

    it('method 2: teamId alone routes to the team lead', async () => {
      backend.post.mockResolvedValue(leadPayload);

      await tools.assignLead(
        { tenantId: TENANT, actorRole: 'admin', leadId: 'lead1', teamId: 't1' },
        undefined,
        req,
      );

      expect(backend.post).toHaveBeenCalledWith(
        '/api/v1/mcp/crm/leads/lead1/assign',
        {
          assignedTo: undefined,
          teamId: 't1',
          isRoundRobin: undefined,
          actorUserId: undefined,
        },
        { headers: { 'x-tenant-id': TENANT } },
      );
    });

    it('method 3: teamId + isRoundRobin round-robins across the team', async () => {
      backend.post.mockResolvedValue(leadPayload);

      await tools.assignLead(
        {
          tenantId: TENANT,
          actorRole: 'admin',
          leadId: 'lead1',
          teamId: 't1',
          isRoundRobin: true,
        },
        undefined,
        req,
      );

      expect(backend.post).toHaveBeenCalledWith(
        '/api/v1/mcp/crm/leads/lead1/assign',
        {
          assignedTo: undefined,
          teamId: 't1',
          isRoundRobin: true,
          actorUserId: undefined,
        },
        { headers: { 'x-tenant-id': TENANT } },
      );
    });

    it('lets a lead agent assign while stripping actor attribution', async () => {
      backend.post.mockResolvedValue(leadPayload);

      const result = await tools.assignLead(
        {
          tenantId: TENANT,
          actorRole: 'admin',
          leadId: 'lead1',
          teamId: 't1',
          actorUserId: 'spoofed-user',
        },
        undefined,
        {
          headers: { 'x-actor-role': 'lead_agent' },
        },
      );

      expect(result.isError).toBeFalsy();
      expect(backend.post).toHaveBeenCalledWith(
        '/api/v1/mcp/crm/leads/lead1/assign',
        {
          assignedTo: undefined,
          teamId: 't1',
          isRoundRobin: undefined,
          actorUserId: undefined,
        },
        { headers: { 'x-tenant-id': TENANT } },
      );
    });

    it('rejects when neither assignedTo nor teamId is given (no backend call)', async () => {
      const result = await tools.assignLead(
        { tenantId: TENANT, actorRole: 'admin', leadId: 'lead1' },
        undefined,
        req,
      );
      expect(result.isError).toBe(true);
      expect(backend.post).not.toHaveBeenCalled();
    });

    it('rejects assignedTo + isRoundRobin together (no backend call)', async () => {
      const result = await tools.assignLead(
        {
          tenantId: TENANT,
          actorRole: 'admin',
          leadId: 'lead1',
          assignedTo: 'u2',
          isRoundRobin: true,
        },
        undefined,
        req,
      );
      expect(result.isError).toBe(true);
      expect(backend.post).not.toHaveBeenCalled();
    });

    it('surfaces a backend validation error (e.g. invalid assignee) as isError', async () => {
      backend.post.mockRejectedValue(
        new BackendException(
          400,
          'Assignee must be the team lead or a member of the selected team',
        ),
      );
      const result = await tools.assignLead(
        {
          tenantId: TENANT,
          actorRole: 'admin',
          leadId: 'lead1',
          assignedTo: 'bad',
        },
        undefined,
        req,
      );
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
    });
  });

  describe('qualify_and_handoff', () => {
    it('requires the lead id supplied in agent_metadata', () => {
      const prototype = CrmTools.prototype as unknown as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      const metadata = Reflect.getMetadata(
        'mcp:tool',
        prototype.qualifyAndHandoff,
      ) as {
        parameters: {
          safeParse: (value: unknown) => { success: boolean };
        };
      };

      expect(
        metadata.parameters.safeParse({
          conversationId: 'conversation1',
          inboundMessageId: 'message1',
          phone: '+201012345678',
        }).success,
      ).toBe(false);
      expect(
        metadata.parameters.safeParse({
          leadId: 'lead1',
          conversationId: 'conversation1',
          inboundMessageId: 'message1',
          phone: '+201012345678',
        }).success,
      ).toBe(true);
    });

    it('stores the phone and hands off an already-assigned lead', async () => {
      const payload = {
        id: 'lead1',
        firstName: 'Jane',
        lastName: 'Doe',
        phone: '+201012345678',
        email: null,
        assignedTo: 'u2',
        status: 'open',
        assignedAt: '2026-08-10T10:00:00.000Z',
        conversationId: 'conversation1',
        inboundMessageId: 'message1',
        handoffStatus: 'pending',
      };
      backend.post.mockResolvedValue(payload);

      const result = await tools.qualifyAndHandoff(
        {
          tenantId: 'b'.repeat(24),
          actorRole: 'admin',
          leadId: 'lead1',
          conversationId: 'conversation1',
          inboundMessageId: 'message1',
          phone: '+201012345678',
          teamId: 't1',
          isRoundRobin: true,
        },
        undefined,
        {
          headers: { 'x-actor-role': 'lead_agent' },
        },
      );

      expect(result.isError).toBeFalsy();
      expect(() =>
        LeadHandoffOutputSchema.parse(result.structuredContent),
      ).not.toThrow();
      expect(backend.post).toHaveBeenCalledWith(
        '/api/v1/mcp/crm/conversations/conversation1/qualify-and-handoff',
        {
          leadId: 'lead1',
          inboundMessageId: 'message1',
          phone: '+201012345678',
          assignedTo: undefined,
          teamId: 't1',
          isRoundRobin: true,
        },
        { headers: { 'x-tenant-id': 'b'.repeat(24) } },
      );
    });

    it('rejects unassigned handoff attempts without an assignment target before calling backend', async () => {
      const result = await tools.qualifyAndHandoff(
        {
          tenantId: TENANT,
          actorRole: 'lead_agent',
          leadId: 'lead1',
          conversationId: 'conversation1',
          inboundMessageId: 'message1',
          phone: '+201012345678',
        },
        undefined,
        req,
      );

      expect(result.isError).toBe(true);
      expect(backend.post).not.toHaveBeenCalled();
    });

    it('accepts conversation context from tool arguments in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      backend.post.mockResolvedValue({
        id: 'lead1',
        firstName: null,
        lastName: null,
        phone: '+201012345678',
        email: null,
        assignedTo: 'u2',
        status: 'open',
        assignedAt: null,
        conversationId: 'body-conversation',
        inboundMessageId: 'body-message',
        handoffStatus: 'pending',
      });

      try {
        await tools.qualifyAndHandoff(
          {
            tenantId: TENANT,
            actorRole: 'lead_agent',
            leadId: 'lead1',
            conversationId: 'body-conversation',
            inboundMessageId: 'body-message',
            phone: '+201012345678',
            teamId: 't1',
          },
          undefined,
          undefined,
        );

        expect(backend.post).toHaveBeenCalledWith(
          '/api/v1/mcp/crm/conversations/body-conversation/qualify-and-handoff',
          expect.objectContaining({
            leadId: 'lead1',
            inboundMessageId: 'body-message',
            assignedTo: undefined,
            teamId: 't1',
          }),
          { headers: { 'x-tenant-id': TENANT } },
        );
      } finally {
        if (originalEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe('meta_leads team aliases', () => {
    it('lists teams from the Meta leads namespace', async () => {
      backend.get.mockResolvedValue({
        teams: [
          {
            id: 't1',
            name: 'Sales',
            description: 'General sales',
            memberCount: 2,
            teamLeadName: 'Nora',
            status: 'active',
            isSystemReserved: false,
          },
        ],
        pagination: { page: 1, limit: 100, total: 1, pages: 1 },
      });

      const result = await tools.listMetaLeadTeams(
        { tenantId: TENANT, actorRole: 'lead_agent' },
        undefined,
        req,
      );

      expect(result.isError).toBeFalsy();
      expect(() =>
        TeamsListOutputSchema.parse(result.structuredContent),
      ).not.toThrow();
    });

    it('gets a team from the Meta leads namespace', async () => {
      backend.get.mockResolvedValue({
        id: 't1',
        name: 'Sales',
        description: 'General sales',
        status: 'active',
        isSystemReserved: false,
        teamLead: { id: 'u1', name: 'Nora', roleName: 'Lead' },
        members: [],
        memberCount: 0,
      });

      const result = await tools.getMetaLeadTeam(
        { tenantId: TENANT, actorRole: 'lead_agent', teamId: 't1' },
        undefined,
        req,
      );

      expect(result.isError).toBeFalsy();
      expect(() =>
        TeamDetailOutputSchema.parse(result.structuredContent),
      ).not.toThrow();
    });
  });
});
