import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    // The frontend reads its deployment config from NEXT_PUBLIC_* at module
    // load, so the suite pins the same values the live deployment uses.
    env: {
      NEXT_PUBLIC_GENLAYER_CHAIN: "studionet",
      NEXT_PUBLIC_COURTFLOW_ADDRESS: "0xAC2F534da76dFe59e3dBbCB3F822E414E3fd81dE",
    },
  },
});
