/**
 * Standard response envelope returned by the TechTrax Express backend.
 * Payloads are wrapped as `{ status, message, data }`. Some lightweight
 * endpoints (e.g. `/health`) return a flat object with no `data` field.
 */
export interface ApiEnvelope<T> {
  status?: string;
  message?: string;
  data?: T;
  [key: string]: unknown;
}
