import { Injectable } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import {
  ACTOR_ROLES,
  ROLE_CAPABILITIES,
  rolesWithCapability,
} from '../common/mcp/authorization.util';
import type { ActorRole, Capability } from '../common/mcp/authorization.util';
import { CAPABILITY_METADATA_KEY } from '../common/mcp/tool-authorization.guard';

// @rekog/mcp-nest tags each @Tool method with this metadata key.
const MCP_TOOL_METADATA_KEY = 'mcp:tool';

export type ToolAccess = {
  name: string;
  /** The capability required to call the tool, or null if unrestricted. */
  capability: Capability | null;
  /** Roles allowed to call the tool. */
  allowedRoles: ActorRole[];
};

/**
 * Enumerates every registered MCP tool and, using each tool's `@RequireCapability`
 * metadata + the `ROLE_CAPABILITIES` policy, computes which roles may call it.
 * Backs the `GET /tool-access` discovery endpoint (a plain HTTP view of the
 * per-call authorization policy — handy because `tools/list` is not role-filtered
 * in the argument-based model).
 */
@Injectable()
export class ToolAccessService {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  /** All tools with their required capability + allowed roles, sorted by name. */
  listTools(): ToolAccess[] {
    const tools: ToolAccess[] = [];

    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (!instance || typeof instance !== 'object') continue;
      const prototype = Object.getPrototypeOf(instance) as object | null;
      if (!prototype) continue;

      for (const methodName of this.scanner.getAllMethodNames(prototype)) {
        const method = (prototype as Record<string, unknown>)[methodName];
        if (typeof method !== 'function') continue;

        const toolMeta = this.reflector.get<{ name?: string } | undefined>(
          MCP_TOOL_METADATA_KEY,
          method,
        );
        if (!toolMeta?.name) continue;

        const capability =
          this.reflector.get<Capability | undefined>(
            CAPABILITY_METADATA_KEY,
            method,
          ) ?? null;

        tools.push({
          name: toolMeta.name,
          capability,
          allowedRoles: capability
            ? rolesWithCapability(capability)
            : [...ACTOR_ROLES],
        });
      }
    }

    return tools.sort((a, b) => a.name.localeCompare(b.name));
  }

  private groupByNamespace(
    tools: ReadonlyArray<{ name: string }>,
  ): Record<string, string[]> {
    const grouped: Record<string, string[]> = {};

    for (const tool of tools) {
      const namespace = tool.name.split('.', 1)[0] || 'other';
      (grouped[namespace] ??= []).push(tool.name);
    }

    return Object.fromEntries(
      Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)),
    );
  }

  /** Full matrix: policy per role + every tool's access + tools grouped by role. */
  matrix() {
    const tools = this.listTools();
    const toolsByNamespace = this.groupByNamespace(tools);
    const byRole = Object.fromEntries(
      ACTOR_ROLES.map((role) => [
        role,
        tools.filter((t) => t.allowedRoles.includes(role)).map((t) => t.name),
      ]),
    ) as Record<ActorRole, string[]>;

    return {
      roles: [...ACTOR_ROLES],
      capabilitiesByRole: ROLE_CAPABILITIES,
      tools,
      toolsByRole: byRole,
      namespaces: Object.keys(toolsByNamespace),
      toolsByNamespace,
    };
  }

  /** The tools a single role may call (with each tool's required capability). */
  forRole(role: ActorRole) {
    const tools = this.listTools()
      .filter((t) => t.allowedRoles.includes(role))
      .map((t) => ({ name: t.name, capability: t.capability }));
    const toolsByNamespace = this.groupByNamespace(tools);
    return {
      role,
      capabilities: ROLE_CAPABILITIES[role],
      tools,
      namespaces: Object.keys(toolsByNamespace),
      toolsByNamespace,
    };
  }
}
