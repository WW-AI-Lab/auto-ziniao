import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@ww-ai-lab/auto-ziniao-core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@ww-ai-lab/auto-ziniao-schemas": path.resolve(__dirname, "packages/schemas/src/index.ts"),
      "@ww-ai-lab/auto-ziniao-schemas/webadmin": path.resolve(__dirname, "packages/schemas/src/webadmin.ts"),
      "@ww-ai-lab/auto-ziniao-zclaw": path.resolve(__dirname, "packages/zclaw/src/index.ts"),
      "@ww-ai-lab/auto-ziniao-flow-engine": path.resolve(__dirname, "packages/flow-engine/src/index.ts"),
      "@ww-ai-lab/auto-ziniao-self-heal": path.resolve(__dirname, "packages/self-heal/src/index.ts"),
      "@ww-ai-lab/auto-ziniao": path.resolve(__dirname, "packages/cli/src/index.ts"),
      "@ww/api": path.resolve(__dirname, "apps/api/src/index.ts"),
      "@ww-ai-lab/auto-ziniao-web": path.resolve(__dirname, "apps/web/src/main.tsx")
    }
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node"
  }
});
