import { loadConfig } from "@ss/shared";
import fp from "fastify-plugin";

export const configPlugin = fp(async (app) => {
  app.decorate("config", loadConfig());
});
