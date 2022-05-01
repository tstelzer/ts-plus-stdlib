/// <reference types="vitest" />
import * as path from "path";
import { defineConfig } from "vite";

function aliases(...packages: string[]): {} {
  const alias = {};
  for (const p of packages) {
    alias[`@tsplus/${p}/test`] = path.resolve(__dirname, `./packages/${p}/test/esm`);
    alias[`@tsplus/${p}/examples`] = path.resolve(__dirname, `./packages/${p}/examples/esm`);
    alias[`@tsplus/${p}`] = path.resolve(__dirname, `./packages/${p}/build/esm`);
  }
  return alias;
}

export default defineConfig({
  resolve: {
    alias: aliases("stdlib")
  },
  test: {
    include: ["packages/*/build/test/Show.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"]
  }
});
