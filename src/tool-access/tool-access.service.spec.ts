import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { DiscoveryModule } from '@nestjs/core';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { RequireCapability } from '../common/mcp/tool-authorization.guard';
import { BackendHttpService } from '../common/backend/backend-http.service';
import { CrmTools } from '../tools/crm/crm.tools';
import { ToolAccessService } from './tool-access.service';

// A couple of fake tool providers so the service has something to discover.
@Injectable()
class FakeStatsTool {
  @Tool({ name: 'fake.stats', description: 'x', parameters: z.object({}) })
  @RequireCapability('statistics:read')
  run() {
    return { content: [] };
  }
}

@Injectable()
class FakePublicTool {
  @Tool({ name: 'fake.public', description: 'x', parameters: z.object({}) })
  ping() {
    return { content: [] };
  }
}

describe('ToolAccessService', () => {
  let service: ToolAccessService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      providers: [
        ToolAccessService,
        FakeStatsTool,
        FakePublicTool,
        CrmTools,
        { provide: BackendHttpService, useValue: {} },
      ],
    }).compile();
    await moduleRef.init();
    service = moduleRef.get(ToolAccessService);
  });

  it('discovers tools and computes allowed roles from the capability', () => {
    const tools = service.listTools();
    const stats = tools.find((t) => t.name === 'fake.stats');
    const pub = tools.find((t) => t.name === 'fake.public');

    expect(stats).toEqual({
      name: 'fake.stats',
      capability: 'statistics:read',
      allowedRoles: ['doctor', 'receptionist', 'admin'],
    });
    // A tool with no @RequireCapability is unrestricted → every role.
    expect(pub).toEqual({
      name: 'fake.public',
      capability: null,
      allowedRoles: [
        'patient',
        'doctor',
        'receptionist',
        'admin',
        'lead_agent',
      ],
    });
  });

  it('matrix groups tools by role', () => {
    const m = service.matrix();
    expect(m.roles).toEqual([
      'patient',
      'doctor',
      'receptionist',
      'admin',
      'lead_agent',
    ]);
    expect(m.toolsByRole.patient).toContain('fake.public');
    expect(m.toolsByRole.patient).not.toContain('fake.stats');
    expect(m.toolsByRole.receptionist).toEqual(
      expect.arrayContaining(['fake.public', 'fake.stats']),
    );
    expect(m.namespaces).toEqual(expect.arrayContaining(['crm', 'meta_leads']));
    expect(m.toolsByNamespace.meta_leads).toEqual([
      'meta_leads.qualify_and_handoff',
    ]);
    expect(m.toolsByRole.lead_agent).toEqual(
      expect.arrayContaining(m.toolsByNamespace.meta_leads),
    );
  });

  it('forRole returns only that role tools', () => {
    expect(service.forRole('patient').tools.map((t) => t.name)).not.toContain(
      'fake.stats',
    );
    expect(service.forRole('admin').tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['fake.public', 'fake.stats']),
    );

    const leadAgent = service.forRole('lead_agent');
    expect(leadAgent.namespaces).toContain('meta_leads');
    expect(leadAgent.toolsByNamespace.meta_leads).toEqual([
      'meta_leads.qualify_and_handoff',
    ]);
  });
});
