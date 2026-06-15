import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@ziniao/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@ziniao/schemas": path.resolve(__dirname, "packages/schemas/src/index.ts"),
      "@ziniao/schemas/webadmin": path.resolve(__dirname, "packages/schemas/src/webadmin.ts"),
      "@ziniao/zclaw": path.resolve(__dirname, "packages/zclaw/src/index.ts"),
      "@ziniao/flow-engine": path.resolve(__dirname, "packages/flow-engine/src/index.ts"),
      "@ziniao/self-heal": path.resolve(__dirname, "packages/self-heal/src/index.ts"),
      "@ziniao/cli": path.resolve(__dirname, "packages/cli/src/index.ts"),
      "@ziniao/webadmin-api": path.resolve(__dirname, "apps/webadmin-api/src/index.ts"),
      "@ziniao/webadmin-frontend": path.resolve(__dirname, "apps/webadmin-frontend/src/main.tsx")
    }
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node"
  }
});
