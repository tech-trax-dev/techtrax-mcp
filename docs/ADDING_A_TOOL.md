# Adding a Tool — Developer Guide

How to add a new MCP tool to the TechTrax MCP server, following the conventions
already used by `health`, `tenant-info`, `appointment`, and `statistics`.

> **Stack note:** this server is **NestJS + [`@rekog/mcp-nest`](https://www.npmjs.com/package/@rekog/mcp-nest)**.
> Tools are class methods decorated with `@Tool(...)`, not `server.tool()` calls.
> Generic MCP advice about `mcp-use`/`server.tool` does **not** apply here — follow
> the patterns below.

---

## 1. Mental model

```
AI client ──POST /mcp──▶  @Tool method  ──BackendHttpService──▶  Express backend
            x-api-key       (this repo)      x-internal-api-key      /api/v1/mcp/...
```

A tool is a thin adapter. Its only job:

1. Validate input (Zod `parameters`).
2. Resolve tenant context.
3. Make **one** backend call via `BackendHttpService`.
4. Shape the response into an `McpToolResult` (text + `structuredContent`).

**No business logic lives here** — that belongs in the backend. If you find
yourself computing, joining, or transforming domain data in a tool, push it to a
backend endpoint instead.

## 2. Anatomy of a namespace

Each namespace is a self-contained folder under [`src/tools/`](../src/tools/) plus
one schema file under [`src/contracts/`](../src/contracts/):

| File | Responsibility |
| --- | --- |
| `src/contracts/<name>.schemas.ts` | Zod **output** contracts + inferred types |
| `src/tools/<name>/<name>.tools.ts` | The `@Tool`-decorated handler class |
| `src/tools/<name>/<name>.module.ts` | Registers the tools with the MCP server |
| `src/tools/<name>/<name>.tools.spec.ts` | Unit tests (backend mocked) |

Then one line in [`src/tools/tools.module.ts`](../src/tools/tools.module.ts) wires
the namespace in. **No other infra changes are needed.**

---

## 3. Add a tool to an EXISTING namespace

Say you want `tenant_info.get_clinic_status`. Three edits:

### 3a. Define the output schema — `src/contracts/tenant-info.schemas.ts`

```typescript
/** Output of `tenant_info.get_clinic_status`. */
export const ClinicStatusOutputSchema = z.object({
  name: z.string(),
  timezone: z.string(),
  currentStatus: ClinicCurrentStatusSchema,
});
export type ClinicStatusOutput = z.infer<typeof ClinicStatusOutputSchema>;
```

- Mirror the **exact** payload the backend returns.
- Any field the backend may omit must be `.nullable()`.

### 3b. Add the handler method — `src/tools/tenant-info/tenant-info.tools.ts`

```typescript
@Tool({
  name: 'tenant_info.get_clinic_status',
  description:
    "Returns whether the clinic is open right now: name, timezone, and " +
    "currentStatus (open_now | closed_now | closed_today). Use for 'is the " +
    "clinic open?' questions. For full contact/hours use get_clinic_profile.",
  parameters: z.object({ format: formatSchema.optional() }),
  outputSchema: ClinicStatusOutputSchema,
  annotations: TOOL_ANNOTATIONS,
})
async getClinicStatus(
  args: { format?: OutputFormat },
  _context: unknown,
  request?: ToolRequest,
): Promise<McpToolResult> {
  const format = args.format ?? 'json';
  const tenantId = this.resolveTenantId(request);
  if (!tenantId) {
    return errorResult(
      'Tenant context is missing. Please authenticate with a tenant-scoped client.',
    );
  }

  try {
    const data = await this.getWithTenantHeader<ClinicStatusOutput>(
      tenantId,
      '/api/v1/mcp/tenant-info/clinic-status',
    );
    return this.formatResult(data, format, (p) => `**${p.name}**: ${p.currentStatus}`);
  } catch (e) {
    if (e instanceof BackendException && e.status === 404) {
      return errorResult('Clinic not found for this tenant.');
    }
    return errorResult(`Failed to fetch clinic status: ${(e as Error).message}`);
  }
}
```

Don't forget to import the new schema + type at the top of the file.

### 3c. Cover it with a test (see [§5](#5-testing)).

That's it — `@Tool` auto-registers the method; no module change is needed when
adding to an existing class.

---

## 4. Add a NEW namespace (e.g. `billing`)

### 4a. `src/contracts/billing.schemas.ts`

```typescript
import { z } from 'zod';

/** Output of `billing.get_invoice`. */
export const InvoiceOutputSchema = z.object({
  id: z.string(),
  patientName: z.string(),
  total: z.number(),
  currency: z.string(),
  status: z.enum(['paid', 'unpaid', 'partial']),
  issuedAt: z.string(),
  paidAt: z.string().nullable(),
});
export type InvoiceOutput = z.infer<typeof InvoiceOutputSchema>;
```

### 4b. `src/tools/billing/billing.tools.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { BackendHttpService } from '../../common/backend/backend-http.service';
import { BackendException } from '../../common/errors/backend.exception';
import { errorResult } from '../../common/mcp/tool-response.util';
import type { McpToolResult } from '../../common/mcp/tool-response.util';
import { InvoiceOutputSchema } from '../../contracts/billing.schemas';
import type { InvoiceOutput } from '../../contracts/billing.schemas';

type ToolRequest = {
  headers?: Record<string, string | string[] | undefined>;
  user?: { tenantId?: string; tenant?: { id?: string } };
};

// Read-only lookup: safe to retry, no side effects, talks to an external system.
const TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

@Injectable()
export class BillingTools {
  constructor(private readonly backend: BackendHttpService) {}

  @Tool({
    name: 'billing.get_invoice',
    description:
      'Returns one invoice by id: patientName, total, currency, status ' +
      '(paid | unpaid | partial), issuedAt, paidAt. Use for billing/payment ' +
      'questions about a specific invoice. Returns an error if the id is unknown.',
    parameters: z.object({
      invoiceId: z.string().min(1).describe('The invoice id to look up.'),
    }),
    outputSchema: InvoiceOutputSchema,
    annotations: TOOL_ANNOTATIONS,
  })
  async getInvoice(
    args: { invoiceId: string },
    _context: unknown,
    request?: ToolRequest,
  ): Promise<McpToolResult> {
    const tenantId = this.resolveTenantId(request);
    if (!tenantId) {
      return errorResult(
        'Tenant context is missing. Please authenticate with a tenant-scoped client.',
      );
    }

    try {
      const data = await this.backend.get<InvoiceOutput>(
        `/api/v1/mcp/billing/invoices/${encodeURIComponent(args.invoiceId)}`,
        { headers: { 'x-tenant-id': tenantId } },
      );
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    } catch (e) {
      if (e instanceof BackendException && e.status === 404) {
        return errorResult('Invoice not found.');
      }
      return errorResult(`Failed to fetch invoice: ${(e as Error).message}`);
    }
  }

  private resolveTenantId(request?: ToolRequest): string | null {
    const fromUser = request?.user?.tenantId ?? request?.user?.tenant?.id;
    if (fromUser) return fromUser;
    const h = request?.headers?.['x-tenant-id'];
    if (typeof h === 'string' && h.trim()) return h.trim();
    if (Array.isArray(h) && h[0]?.trim()) return h[0].trim();
    return null;
  }
}
```

> Tip: for multi-tool namespaces, copy the `resolveTenantId` / `getWithTenantHeader`
> / `formatResult` helpers from
> [`tenant-info.tools.ts`](../src/tools/tenant-info/tenant-info.tools.ts) so you get
> the shared `format: json | markdown` support for free.

### 4c. `src/tools/billing/billing.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { McpModule } from '@rekog/mcp-nest';
import { MCP_SERVER_NAME } from '../../config/mcp.constants';
import { BillingTools } from './billing.tools';

@Module({
  imports: [McpModule.forFeature([BillingTools], MCP_SERVER_NAME)],
  providers: [BillingTools],
})
export class BillingToolsModule {}
```

> ⚠️ The second arg to `forFeature` **must** be `MCP_SERVER_NAME`. If it doesn't
> match the name in `McpModule.forRoot`, the tools silently won't register.

### 4d. Register the namespace — `src/tools/tools.module.ts`

```typescript
import { BillingToolsModule } from './billing/billing.module';

@Module({
  imports: [
    HealthToolsModule,
    TenantInfoToolsModule,
    AppointmentToolsModule,
    StatisticsToolsModule,
    BillingToolsModule, // ← add
  ],
})
export class ToolsModule {}
```

---

## 5. Testing

Unit tests instantiate the tools class directly with a **mocked** backend — no
Nest, no network. Pattern (see
[`tenant-info.tools.spec.ts`](../src/tools/tenant-info/tenant-info.tools.spec.ts)):

```typescript
import 'reflect-metadata';
import { BackendException } from '../../common/errors/backend.exception';
import { InvoiceOutputSchema } from '../../contracts/billing.schemas';
import { BillingTools } from './billing.tools';

const request = { user: { tenantId: '64b7f0000000000000000001' } };

describe('BillingTools', () => {
  let backend: { get: jest.Mock };
  let tools: BillingTools;

  beforeEach(() => {
    backend = { get: jest.fn() };
    tools = new BillingTools(backend as never);
  });

  it('returns schema-valid structuredContent on success', async () => {
    const invoice = { id: 'inv1', patientName: 'Jane', total: 100, currency: 'EGP', status: 'paid', issuedAt: '2026-01-01', paidAt: '2026-01-02' };
    backend.get.mockResolvedValue(invoice);

    const result = await tools.getInvoice({ invoiceId: 'inv1' }, undefined, request);

    expect(result.isError).toBeFalsy();
    expect(() => InvoiceOutputSchema.parse(result.structuredContent)).not.toThrow();
  });

  it('maps a 404 to a friendly error result, not a thrown stack', async () => {
    backend.get.mockRejectedValue(new BackendException(404, 'not found'));
    const result = await tools.getInvoice({ invoiceId: 'nope' }, undefined, request);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it('errors when tenant context is missing', async () => {
    const result = await tools.getInvoice({ invoiceId: 'inv1' }, undefined, {});
    expect(result.isError).toBe(true);
  });
});
```

Run: `npm test`. Every new tool needs at minimum: a success case, a backend-error
case, and a missing-tenant case.

---

## 6. Best practices (enforced in review)

**Naming**
- Tool name = `namespace.snake_case_action` (e.g. `billing.get_invoice`). Matches
  the existing four namespaces.
- One tool = one focused capability. Don't build a "do-everything" tool with a
  `mode` switch.

**Descriptions (this is the model's only manual — write it for an LLM)**
- State exactly what it returns (list the fields), *when to use it*, and *when NOT
  to* (point to the sibling tool instead). See the `tenant_info` descriptions for
  the bar to hit.
- Call out non-obvious semantics (e.g. "an empty array is a valid result, not an
  error"; pagination rules; advisory caveats).

**Parameters (input `Zod`)**
- `.describe()` every non-obvious field.
- Use strict types: `z.enum([...])` over free strings, `.int().positive().max(50)`
  for pagination limits.
- Make optional things actually `.optional()` with sane server-side defaults.

**Output**
- Always attach `outputSchema` **and** return `structuredContent` so clients get
  typed data. The two must match.
- Mirror the backend payload faithfully; `.nullable()` anything optional.

**Annotations** — set them honestly; clients use them for safety:
- `readOnlyHint` / `destructiveHint` — a GET-style lookup is `readOnly: true,
  destructive: false`; a cancel/delete is `readOnly: false, destructive: true`.
- `idempotentHint` — true if calling twice has the same effect (reads, cancels);
  false for "book"/"create".
- `openWorldHint` — true when it reaches the external backend (almost always true
  here; `health.ping` is the rare `false`).

**Errors**
- Return `errorResult('human message')` — never throw raw. The model reads the
  message; give it something actionable ("Use list_doctors to get valid IDs").
- Map known statuses (`BackendException.status === 404`) to specific messages.
- Distinguish "empty but valid" (success, `structuredContent` present) from
  "failed" (`isError: true`, no `structuredContent`).

**Backend calls**
- Exactly one backend call per tool. Go through `BackendHttpService` only — never
  import axios directly.
- Always pass the `x-tenant-id` header (via `getWithTenantHeader` or inline). The
  backend's `mcpInternalAuth` middleware rejects calls without a valid tenant id.
- `encodeURIComponent` every path segment that comes from input.

**Security / data hygiene**
- Never log PHI or secrets. Auth headers are already redacted globally in
  [`app.module.ts`](../src/app.module.ts); don't undo that.
- Don't add new inbound auth — it's handled centrally by `McpClientGuard`.

---

## 7. Pre-merge checklist

- [ ] Output schema in `src/contracts/<name>.schemas.ts`, nullable where needed.
- [ ] `@Tool` has `name`, a model-grade `description`, `parameters`, `outputSchema`,
      `annotations`.
- [ ] Tenant context resolved; missing-tenant returns `errorResult`.
- [ ] Exactly one `BackendHttpService` call; `x-tenant-id` sent; inputs encoded.
- [ ] Returns `structuredContent` on success; `isError` on failure; known statuses
      mapped.
- [ ] (New namespace only) module uses `forFeature([...], MCP_SERVER_NAME)` and is
      imported in `tools.module.ts`.
- [ ] Tests: success + backend-error + missing-tenant. `npm test` green.
- [ ] `npm run build` and `npm run lint:ci` pass.
- [ ] Verified in the MCP Inspector (`npx @modelcontextprotocol/inspector` →
      `http://localhost:3100/mcp`, send `x-api-key`).
```
