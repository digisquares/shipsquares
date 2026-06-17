import { AppError } from "@ss/shared";

// RFC 9457 problem+json with a stable machine `code` and, for validation
// failures, a populated `errors` array. Unknown errors become a 500 that never
// leaks a message, stack, or SQL string (04-api-openapi.md).
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance?: string;
  errors?: { path: string; message: string }[];
}

interface ValidationIssue {
  instancePath?: string;
  message?: string;
  params?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function issuePath(issue: ValidationIssue): string {
  if (issue.instancePath) return issue.instancePath;
  const missing = issue.params?.missingProperty;
  return typeof missing === "string" ? `/${missing}` : "";
}

export function toProblem(err: unknown, instance?: string): ProblemDetails {
  if (err instanceof AppError) {
    return {
      type: "about:blank",
      title: err.name,
      status: err.status,
      code: err.code,
      ...(err.message ? { detail: err.message } : {}),
      ...(instance ? { instance } : {}),
    };
  }

  const rec = isRecord(err) ? err : {};

  // Fastify schema-validation errors carry a `validation` array.
  if (Array.isArray(rec.validation)) {
    const issues = rec.validation as ValidationIssue[];
    return {
      type: "about:blank",
      title: "Validation Failed",
      status: 400,
      code: "validation.failed",
      detail: typeof rec.message === "string" ? rec.message : "Request validation failed",
      errors: issues.map((i) => ({ path: issuePath(i), message: i.message ?? "invalid" })),
      ...(instance ? { instance } : {}),
    };
  }

  const status = typeof rec.statusCode === "number" ? rec.statusCode : 500;
  const code =
    status === 404
      ? "not_found"
      : status === 429
        ? "rate_limited"
        : status >= 500
          ? "internal_error"
          : "request_error";
  // 5xx must not leak internals; only surface client-error messages.
  const detail =
    status >= 500 ? "Internal Server Error" : err instanceof Error ? err.message : "Request error";

  return {
    type: "about:blank",
    title: status >= 500 ? "Internal Server Error" : "Request Error",
    status,
    code,
    detail,
    ...(instance ? { instance } : {}),
  };
}
