import 'reflect-metadata';
import { BackendException } from '../../common/errors/backend.exception';
import {
  TeamsListOutputSchema,
  TeamDetailOutputSchema,
  LeadAssignmentOutputSchema,
} from '../../contracts/crm.schemas';
import { CrmTools } from './crm.tools';

const TENANT = 'a'.repeat(24);
const req = { headers: { 'x-tenant-id': TENANT } };

describe('CrmTools', () => {
  let backend: { get: jest.Mock; post: jest.Mock };
  let tools: CrmTools;

  beforeEach(() => {
    backend = { get: jest.fn(), post: jest.fn() };
    tools = new CrmTools(backend as never);
  });

  describe('create_lead', () => {
    const leadPayload = {
      id: 'lead9',
      firstName: 'Mohammed',
      lastName: 'Emam',
      phone: '01204045635',
      email: null,
      assignedTo: null,
      status: 'open',
      assignedAt: null,
    };

    it('creates an unassigned lead and returns schema-valid output', async () => {
      backend.post.mockResolvedValue(leadPayload);

      const result = await tools.createLead(
        {
          tenantId: TENANT,
          actorRole: 'admin',
          firstName: 'Mohammed',
          lastName: 'Emam',
          phone: '01204045635',
          address: 'Shubra Hares, Toukh, Qalyubia',
        },
        undefined,
        req,
      );

      expect(result.isError).toBeFalsy();
      expect(() =>
        LeadAssignmentOutputSchema.parse(result.structuredContent),
      ).not.toThrow();
      expect(backend.post).toHaveBeenCalledWith(
        '/api/v1/mcp/crm/leads',
        {
          firstName: 'Mohammed',
          lastName: 'Emam',
          phone: '01204045635',
          email: undefined,
          address: 'Shubra Hares, Toukh, Qalyubia',
          priority: undefined,
        },
        { headers: { 'x-tenant-id': TENANT } },
      );
    });

    it('maps a 409 duplicate to a friendly isError', async () => {
      backend.post.mockRejectedValue(
        new BackendException(409, 'Lead with this phone number already exists'),
      );
      const result = await tools.createLead(
        {
          tenantId: TENANT,
          actorRole: 'admin',
          firstName: 'Mohammed',
          lastName: 'Emam',
          phone: '01204045635',
        },
        undefined,
        req,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/already exists/i);
      expect(result.structuredContent).toBeUndefined();
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
});
