# Meta Lead ID Handoff Design

## Goal

Allow the Meta lead agent to pass the existing lead ID when it stores a phone
number and starts human handoff, without allowing it to update a lead from a
different conversation.

## Request Contract

`meta_leads.qualify_and_handoff` requires these arguments:

- `tenantId`
- `actorRole`
- `leadId`
- `conversationId`
- `inboundMessageId`
- `phone`

The AI client must copy `leadId` from `agent_metadata.lead_id`. It must not
generate, infer, or substitute an ID from conversation text.

## Data Flow

1. The backend resolves the lead from `conversation.customerProfileId` when an
   inbound Meta message is queued.
2. The backend sends that value as `agent_metadata.lead_id` in `/chat/sync`.
3. The agent passes it as `leadId` to `meta_leads.qualify_and_handoff` after the
   lead explicitly provides a phone number.
4. The MCP forwards `leadId`, `inboundMessageId`, and `phone` to the backend
   handoff endpoint.
5. The backend loads the tenant-scoped conversation and requires the supplied
   `leadId` to equal `conversation.customerProfileId`.
6. Existing checks still require the phone to appear in the current inbound
   message and the lead to be assigned before handoff.
7. The backend updates that lead's phone and prepares human takeover.

## Error Handling

- Missing or malformed `leadId`: reject the request with HTTP 400.
- `leadId` does not belong to the conversation: reject with HTTP 400 before
  reading or updating the lead.
- Existing conversation, inbound-turn, phone, assignment, and handoff conflict
  errors remain unchanged.

## Tests

- MCP schema advertises and requires `leadId`.
- MCP forwards `leadId` to the backend handoff endpoint.
- Backend worker includes the conversation's lead ID in
  `agent_metadata.lead_id`.
- Backend handoff updates the matching lead.
- Backend handoff rejects a mismatched lead ID without any lead write.
