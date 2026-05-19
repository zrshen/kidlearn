import { defineConfig } from "@playwright/test";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..");
const stubImage = path.join(repoRoot, "tests/fixtures/stub.png");
const stubSuggest = path.join(repoRoot, "tests/fixtures/suggest_stub.json");

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  use: { baseURL: "http://localhost:3000" },
  globalSetup: "./e2e/global-setup.ts",
  webServer: [
    {
      command: `uv run uvicorn server.main:app --port 8000`,
      cwd: repoRoot,
      url: "http://localhost:8000/api/used-words",
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        FLASHCARD_STUB_IMAGE: stubImage,
        FLASHCARD_STUB_SUGGEST: stubSuggest,
      },
    },
    {
      command: "npm run dev",
      url: "http://localhost:3000",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
