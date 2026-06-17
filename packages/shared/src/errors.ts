/**
 * The application error taxonomy. Throw a typed {@link AppError} (or a subclass)
 * anywhere; the Fastify error handler renders it as RFC 9457 problem+json via
 * {@link toProblem} (04-api-openapi.md).
 */

export interface AppErrorOptions {
  status?: number;
  code?: string;
  details?: unknown;
  cause?: unknown;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.status = options.status ?? 500;
    this.code = options.code ?? "internal_error";
    if (options.details !== undefined) this.details = options.details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", details?: unknown) {
    super(message, { status: 400, code: "validation_error", details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, { status: 401, code: "unauthorized" });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, { status: 403, code: "forbidden" });
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, { status: 404, code: "not_found" });
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", details?: unknown) {
    super(message, { status: 409, code: "conflict", details });
  }
}

// NOTE: the problem+json renderer lives in apps/server/src/lib/problem.ts —
// it sanitizes 5xx details. A duplicate here used to leak `err.message` for
// every status and was never imported by the server; removed so the unsafe
// variant can't be picked up by accident.
