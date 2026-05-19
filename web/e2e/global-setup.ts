import fs from "node:fs";
import path from "node:path";

export default async function globalSetup() {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const live = path.join(repoRoot, "used_words.json");
  const backup = path.join(repoRoot, "used_words.json.e2e-backup");
  fs.copyFileSync(live, backup);
  // Reset to a tiny fixture for predictability
  fs.writeFileSync(live, JSON.stringify(["alpha", "beta"]) + "\n");
  return async () => {
    fs.copyFileSync(backup, live);
    fs.unlinkSync(backup);
  };
}
