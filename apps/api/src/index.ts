export * from "./app.js";
export * from "./config.js";
export * from "./storage.js";
export * from "./triggers.js";
export * from "./runner.js";

import { fileURLToPath } from "node:url";
import { startServer } from "./app.js";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = await startServer();
  const address = app.server.address();
  console.log(`WebAdmin API listening on ${typeof address === "string" ? address : `${address?.address}:${address?.port}`}`);
}
