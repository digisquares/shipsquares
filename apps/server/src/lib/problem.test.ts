import { AppError } from "@ss/shared";
import { describe, expect, it } from "vitest";

import { toProblem } from "./problem.js";

describe("toProblem", () => {
  it("maps an AppError to its status + stable code", () => {
    const problem = toProblem(
      new AppError("name taken", { status: 409, code: "app.name_taken" }),
      "/api/v1/apps",
    );
    expect(problem).toMatchObject({
      status: 409,
      code: "app.name_taken",
      title: "AppError",
      detail: "name taken",
      instance: "/api/v1/apps",
    });
  });

  it("maps a Fastify validation error to 400 validation.failed with errors[]", () => {
    const problem = toProblem(
      {
        statusCode: 400,
        message: "body/name must NOT have fewer than 1 characters",
        validation: [{ instancePath: "/name", message: "must NOT have fewer than 1 characters" }],
      },
      "/api/v1/apps",
    );
    expect(problem.status).toBe(400);
    expect(problem.code).toBe("validation.failed");
    expect(problem.errors).toEqual([
      { path: "/name", message: "must NOT have fewer than 1 characters" },
    ]);
  });

  it("maps an unknown error to 500 without leaking the message", () => {
    const problem = toProblem(new Error("SELECT * FROM secrets failed"));
    expect(problem.status).toBe(500);
    expect(problem.code).toBe("internal_error");
    expect(problem.detail).toBe("Internal Server Error");
    expect(JSON.stringify(problem)).not.toContain("secrets");
  });
});
