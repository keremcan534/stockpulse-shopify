import { configDefaults, defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "jsdom",
    exclude: [...configDefaults.exclude, ".react-router/**"],
    globals: true,
    passWithNoTests: true,
  },
});
