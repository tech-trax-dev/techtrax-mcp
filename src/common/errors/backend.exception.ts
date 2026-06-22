/**
 * Typed error raised by `BackendHttpService` for any failed outbound call to
 * the TechTrax Express backend. The single mapping point for HTTP/network
 * failures so tools never see raw axios stacks.
 */
export class BackendException extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'BackendException';
  }
}
