import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@ziniao/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@ziniao/schemas": path.resolve(__dirname, "packages/schemas/src/index.ts")
    }
  },
  test: {
    include: ["packages/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node"
  }
});
