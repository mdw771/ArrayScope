import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "../..");
  const extensionTestsPath = path.resolve(__dirname, "suite", "index.js");
  const workspacePath = path.resolve(extensionDevelopmentPath, "test", "integration", "workspace");
  await mkdir(workspacePath, { recursive: true });
  let vscodeExecutablePath = await downloadAndUnzipVSCode();
  // Recent macOS bundles renamed the main binary; older test-electron versions expect Electron.
  if (process.platform === "darwin") {
    try {
      await access(vscodeExecutablePath);
    } catch {
      const renamed = path.join(path.dirname(vscodeExecutablePath), "Code");
      await access(renamed);
      vscodeExecutablePath = renamed;
    }
  }
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspacePath, "--disable-extensions"],
  });
}

main().catch((error) => {
  console.error("Extension integration tests failed:", error);
  process.exitCode = 1;
});
