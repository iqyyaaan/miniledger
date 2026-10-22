/**
 * Every failure the API returns on purpose is an `AppError`. Anything else
 * that reaches the error handler is a bug and becomes a generic 500, so we
 * never leak a stack trace or a Postgres message to a client.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'bad_request', message, details);

export const validationFailed = (details: unknown) =>
  new AppError(422, 'validation_failed', 'One or more fields are invalid.', details);

export const unauthorized = (message = 'Authentication required.') =>
  new AppError(401, 'unauthorized', message);

export const forbidden = (message = 'You do not have access to this resource.') =>
  new AppError(403, 'forbidden', message);

export const notFound = (resource = 'Resource') =>
  new AppError(404, 'not_found', `${resource} was not found.`);

export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'conflict', message, details);

export const tooManyRequests = (message: string, retryAfterSeconds?: number) =>
  new AppError(429, 'too_many_requests', message, { retryAfterSeconds });

export const payloadTooLarge = (message: string) =>
  new AppError(413, 'payload_too_large', message);
