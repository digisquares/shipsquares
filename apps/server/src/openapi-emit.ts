import "dotenv/config";

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { buildApp } from "./app.js";

// Boot in no-listen mode, write the OpenAPI document emitted from the live route
// schemas to apps/server/openapi.json (committed), then exit. The committed spec
// is the single source for @ss/openapi-client and the mobile codegen (04).
const app = await buildApp();
const spec = app.swagger();
const outPath = fileURLToPath(new URL("../openapi.json", import.meta.url));
await writeFile(outPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
console.log(`wrote ${outPath}`);
await app.close();
