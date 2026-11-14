/** Errors the API raises deliberately, carrying an HTTP status and a stable code. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', msg, details);

export const unauthorized = (msg = 'You need to sign in to do that.', details?: unknown) =>
  new AppError(401, 'UNAUTHORIZED', msg, details);

export const forbidden = (msg = "You don't have access to that.") =>
  new AppError(403, 'FORBIDDEN', msg);

export const notFound = (what = 'Resource') =>
  new AppError(404, 'NOT_FOUND', `${what} not found.`);

export const conflict = (msg: string) => new AppError(409, 'CONFLICT', msg);

export const tooMany = (msg = 'Too many attempts. Try again shortly.') =>
  new AppError(429, 'TOO_MANY_REQUESTS', msg);

export const serverError = (msg = 'Something went wrong on our end.') =>
  new AppError(500, 'INTERNAL_ERROR', msg);
