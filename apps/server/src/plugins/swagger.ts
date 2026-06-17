import fastifySwagger from "@fastify/swagger";
import scalar from "@scalar/fastify-api-reference";
import { APP_NAME } from "@ss/shared";
import fp from "fastify-plugin";

// Emits the OpenAPI document from the live TypeBox route schemas (never
// hand-authored) and serves the Scalar reference at /docs + raw spec at
// /openapi.json. Must be registered before the routes it documents.
export const swaggerPlugin = fp(async (app) => {
  await app.register(fastifySwagger, {
    openapi: {
      info: { title: `${APP_NAME} API`, version: "0.0.0" },
      servers: [{ url: "/api/v1" }],
      components: {
        securitySchemes: {
          bearerApiKey: { type: "http", scheme: "bearer" },
          sessionCookie: { type: "apiKey", in: "cookie", name: "ss_session" },
        },
      },
    },
  });
  await app.register(scalar, { routePrefix: "/docs" });
  app.get("/openapi.json", { schema: { hide: true } }, () => app.swagger());
});
