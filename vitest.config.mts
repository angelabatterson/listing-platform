import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    env: {
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      DATABASE_URL: "postgres://unused@localhost:1/unused",
      EBAY_CLIENT_ID: "client",
      EBAY_CLIENT_SECRET: "secret",
      EBAY_RUNAME: "ru-name",
    },
  },
});
