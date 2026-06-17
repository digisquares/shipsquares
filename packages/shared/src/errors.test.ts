import { describe, expect, it } from "vitest";

import {
  AppError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "./errors.js";

describe("AppError taxonomy", () => {
  it("ValidationError → 400 / validation_error and carries details", () => {
    const err = new ValidationError("bad input", { field: "name" });
    expect(err).toBeInstanceOf(AppError);
    expect(err.name).toBe("ValidationError");
    expect(err.status).toBe(400);
    expect(err.code).toBe("validation_error");
    expect(err.details).toEqual({ field: "name" });
  });

  it("status codes match the subclass", () => {
    expect(new UnauthorizedError().status).toBe(401);
    expect(new NotFoundError().status).toBe(404);
    expect(new ConflictError().status).toBe(409);
  });

  it("defaults to a 500 internal_error", () => {
    const err = new AppError("boom");
    expect(err.status).toBe(500);
    expect(err.code).toBe("internal_error");
  });
});

// The problem+json renderer (with 5xx sanitization) is the server's
// lib/problem.ts and is tested there — the shared duplicate was removed
// because it leaked error messages on every status.
