# Meta Lead ID Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require the current Meta lead ID during phone qualification, validate it against the conversation, update that lead, and prepare human handoff.

**Architecture:** The backend already derives and sends the lead ID as `agent_metadata.lead_id` in `/chat/sync`. The MCP tool will expose a required `leadId` argument and forward it to the backend; the backend will reject it unless it matches the tenant-scoped conversation's `customerProfileId`, then continue the existing phone and handoff workflow.

**Tech Stack:** NestJS, TypeScript, Zod, Jest, Express, Node.js, Mongoose

## Global Constraints

- `leadId` must come from `agent_metadata.lead_id`; the model must not invent it.
- Never update a lead until `leadId` matches `conversation.customerProfileId`.
- Existing phone-in-current-message and assigned-lead checks remain mandatory.
- Do not add dependencies or change assignment behavior.

---

### Task 1: MCP Tool Contract and Forwarding

**Files:**
- Modify: `D:/develop/techtrax-mcp/src/tools/crm/crm.tools.ts`
- Test: `D:/develop/techtrax-mcp/src/tools/crm/crm.tools.spec.ts`

**Interfaces:**
- Consumes: `agent_metadata.lead_id` supplied by the AI client as `leadId`
- Produces: backend body `{ leadId, inboundMessageId, phone }`

- [ ] **Step 1: Write the failing test**

Add `leadId: 'lead1'` to the successful handoff call and require the backend mock to receive:

```ts
{
  leadId: 'lead1',
  inboundMessageId: 'message1',
  phone: '+201012345678',
}
```

Also parse the tool's Zod metadata and assert that omitting `leadId` fails.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --runInBand src/tools/crm/crm.tools.spec.ts`

Expected: FAIL because the tool neither requires nor forwards `leadId`.

- [ ] **Step 3: Implement the minimum contract change**

Add this required parameter and forward it:

```ts
leadId: z.string().min(1).describe(
  'The existing lead id from agent_metadata.lead_id. Do not infer it.',
)
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- --runInBand src/tools/crm/crm.tools.spec.ts`

Expected: PASS.

### Task 2: Backend Request Validation and Identity Binding

**Files:**
- Modify: `D:/develop/techtrax-backend-restored/src/modules/mcp/controllers/crm.controller.js`
- Modify: `D:/develop/techtrax-backend-restored/src/modules/crm/ai/leadHandoff.service.js`
- Test: `D:/develop/techtrax-backend-restored/tests/unit/modules/crm/ai/leadHandoff.service.test.js`
- Test: existing MCP CRM controller test if present; otherwise add focused coverage to its nearest unit test file

**Interfaces:**
- Consumes: `{ tenantId, leadId, conversationId, inboundMessageId, phone }`
- Produces: unchanged lead handoff response; throws HTTP 400 on lead/conversation mismatch

- [ ] **Step 1: Write failing backend tests**

Require `leadId` in the controller call, and add a service test:

```js
await expect(
  qualifyAndHandoff({
    ...ids,
    leadId: '507f1f77bcf86cd799439099',
    phone: '+201001112233',
  }),
).rejects.toMatchObject({ statusCode: 400 })

expect(leadService.getLead).not.toHaveBeenCalled()
expect(leadService.updateLead).not.toHaveBeenCalled()
```

- [ ] **Step 2: Run focused backend tests and verify RED**

Run: `npm test -- --runInBand tests/unit/modules/crm/ai/leadHandoff.service.test.js`

Expected: FAIL because a mismatched `leadId` is currently ignored.

- [ ] **Step 3: Implement request validation and binding**

Validate `leadId` as an ObjectId in the controller, pass it through the MCP service, and add this check immediately after loading the conversation:

```js
if (String(conversation.customerProfileId) !== String(leadId)) {
  throw createError('leadId does not belong to this conversation', 400)
}
```

Use the validated `leadId` for `getLead`, `updateLead`, and the inbound message's `customerProfileId` filter.

- [ ] **Step 4: Run focused backend tests and verify GREEN**

Run: `npm test -- --runInBand tests/unit/modules/crm/ai/leadHandoff.service.test.js`

Expected: PASS.

### Task 3: Worker Metadata and Internal Completion Path

**Files:**
- Modify: `D:/develop/techtrax-backend-restored/src/modules/crm/queues/aiConversation.worker.js`
- Test: `D:/develop/techtrax-backend-restored/tests/unit/modules/crm/queues/aiConversation.worker.test.js`

**Interfaces:**
- Produces: `/chat/sync.agent_metadata.lead_id`
- Consumes: the same `leadId` when the worker finalizes a prepared handoff

- [ ] **Step 1: Extend the existing worker test**

Keep the assertion that `/chat/sync` receives `agent_metadata.lead_id`, and require the internal completion call to receive `leadId: ids.leadId`.

- [ ] **Step 2: Run the focused worker test and verify RED**

Run: `npm test -- --runInBand tests/unit/modules/crm/queues/aiConversation.worker.test.js`

Expected: FAIL only for the internal handoff call missing `leadId`; metadata assertion already passes.

- [ ] **Step 3: Pass `leadId` to the internal handoff call**

```js
await leadHandoffService.qualifyAndHandoff({
  tenantId,
  leadId,
  conversationId,
  inboundMessageId: messageId,
  phone: currentConversation.aiHandoffPhone,
})
```

- [ ] **Step 4: Run focused worker tests and verify GREEN**

Run: `npm test -- --runInBand tests/unit/modules/crm/queues/aiConversation.worker.test.js`

Expected: PASS.

### Task 4: Full Verification and Delivery

**Files:**
- Verify all changed files in both repositories

- [ ] **Step 1: Verify MCP**

Run: `npm test -- --runInBand && npm run build && npm run lint:ci`

Expected: all commands exit 0.

- [ ] **Step 2: Verify backend**

Run focused CRM AI/MCP tests, then `npm run lint -- <changed files>` if supported by the repository.

Expected: all commands exit 0.

- [ ] **Step 3: Inspect diffs and commit each repository**

Use separate commits so the MCP contract and backend validation can be reviewed independently.
