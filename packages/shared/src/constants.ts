export const APP_NAME = "ShipSquares";

/** REST API version prefix — every resource route lives under this (04-api-openapi.md). */
export const API_PREFIX = "/api/v1";

export const DEFAULT_PORT = 3000;

/** Health/readiness probe bodies (02-foundations.md, 18-installer-ops.md). */
export const HEALTH_OK = { status: "ok" } as const;
export const READY_OK = { status: "ready" } as const;
