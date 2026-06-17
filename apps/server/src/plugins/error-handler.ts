import fp from "fastify-plugin";

import { toProblem } from "../lib/problem.js";

export const errorHandlerPlugin = fp(async (app) => {
  app.setErrorHandler((err, req, reply) => {
    const problem = toProblem(err, req.url);
    if (problem.status >= 500) req.log.error({ err }, "unhandled error");
    void reply.code(problem.status).type("application/problem+json").send(problem);
  });

  app.setNotFoundHandler((req, reply) => {
    const problem = toProblem(
      { statusCode: 404, message: `Route ${req.method} ${req.url} not found` },
      req.url,
    );
    void reply.code(404).type("application/problem+json").send(problem);
  });
});
