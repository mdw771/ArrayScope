import { mkdir } from "node:fs/promises";
import path from "node:path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "../..");
  const extensionTestsPath = path.resolve(__dirname, "suite", "index.js");
  const workspacePath = path.resolve(extensionDevelopmentPath, "test", "integration", "workspace");
  await mkdir(workspacePath, { recursive: true });
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspacePath, "--disable-extensions"],
  });
}

main().catch((error) => {
  console.error("Extension integration tests failed:", error);
  process.exitCode = 1;
});
