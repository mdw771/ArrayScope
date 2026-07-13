import assert from "node:assert/strict";
import * as vscode from "vscode";

const VIEW_TYPE = "scientificImageViewer.viewer";
const fixtureUris: vscode.Uri[] = [];

export async function run(): Promise<void> {
  const tests: Array<[string, () => Promise<void>]> = [
    ["registers custom-editor commands", testCommands],
    ["opens a supported NPY file", testOpenNpy],
    ["opens a grayscale TIFF file", testOpenTiff],
    ["opens malformed input in the viewer", testMalformed],
    ["supports independent custom-editor tabs", testMultipleTabs],
  ];
  try {
    for (const [name, test] of tests) {
      try {
        await test();
        console.log(`PASS: ${name}`);
      } finally {
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      }
    }
  } finally {
    await Promise.all(fixtureUris.map((uri) => vscode.workspace.fs.delete(uri)));
  }
}

async function testCommands(): Promise<void> {
  const extension = vscode.extensions.getExtension("arrayscope.array-scope");
  assert.ok(extension, "ArrayScope development extension was not discovered.");
  await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    "scientificImageViewer.tool.rectangle",
    "scientificImageViewer.tool.ellipse",
    "scientificImageViewer.tool.line",
    "scientificImageViewer.tool.polygon",
    "scientificImageViewer.tool.sampler",
    "scientificImageViewer.computeStatistics",
    "scientificImageViewer.tool.magnifier",
    "scientificImageViewer.tool.pan",
  ]) {
    assert.ok(commands.includes(command), `Missing command ${command}`);
  }
}

async function testOpenNpy(): Promise<void> {
  const uri = await writeFixture("image.npy", createNpy([2, 3], [0, 1, 2, 3, 4, 5]));
  await vscode.commands.executeCommand("vscode.openWith", uri, VIEW_TYPE);
  await waitFor(() => activeCustomEditor()?.viewType === VIEW_TYPE);
  assert.equal(activeCustomEditor()?.viewType, VIEW_TYPE);
}

async function testMalformed(): Promise<void> {
  const uri = await writeFixture("malformed.npy", new Uint8Array([1, 2, 3, 4]));
  await vscode.commands.executeCommand("vscode.openWith", uri, VIEW_TYPE);
  await waitFor(() => activeCustomEditor()?.viewType === VIEW_TYPE);
  assert.equal(activeCustomEditor()?.viewType, VIEW_TYPE);
}

async function testOpenTiff(): Promise<void> {
  const tiff = Buffer.from(
    "TU0AKgAAAAgAEQEAAAMAAAABAAMAAAEBAAMAAAABAAIAAAECAAMAAAABABAAAAEDAAMAAAABAAEAAAEGAAMAAAABAAEAAAERAAQAAAABAAAD6AEVAAMAAAABAAEAAAEWAAQAAAABAAAAAgEXAAQAAAABAAAADAEcAAMAAAABAAEAAAExAAIAAAALAAAA2gFSAAMAAAAAAAAAAAFTAAMAAAABAAEAAIMOAAwAAAADAAAA5oSCAAwAAAAGAAAA/oevAAMAAAAQAAABLoexAAIAAAAHAAABTgAAAABnZW90aWZmLmpzAABAXgAAAAAAAEBWgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAZoAAAAAAAEBWgAAAAAAAAAAAAAAAAAAAAQABAAAAAwQAAAAAAQACCAAAAAABEOYIAYexAAcAAFdHUyA4NAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAIAAwAEAAUABg==",
    "base64",
  );
  const uri = await writeFixture("image.tiff", tiff);
  await vscode.commands.executeCommand("vscode.openWith", uri, VIEW_TYPE);
  await waitFor(() => activeCustomEditor()?.viewType === VIEW_TYPE);
  assert.equal(activeCustomEditor()?.viewType, VIEW_TYPE);
}

async function testMultipleTabs(): Promise<void> {
  const first = await writeFixture("first.npy", createNpy([2, 2], [1, 2, 3, 4]));
  const second = await writeFixture("second.npy", createNpy([2, 2], [5, 6, 7, 8]));
  await vscode.commands.executeCommand("vscode.openWith", first, VIEW_TYPE);
  await vscode.commands.executeCommand("vscode.openWith", second, VIEW_TYPE);
  const customTabs = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === VIEW_TYPE);
  assert.equal(customTabs.length, 2);
}

function activeCustomEditor(): vscode.TabInputCustom | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputCustom ? input : undefined;
}

async function writeFixture(name: string, bytes: Uint8Array): Promise<vscode.Uri> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "Integration test workspace is missing.");
  const uri = vscode.Uri.joinPath(folder.uri, name);
  await vscode.workspace.fs.writeFile(uri, bytes);
  fixtureUris.push(uri);
  return uri;
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for the custom editor.");
}

function createNpy(shape: number[], values: number[]): Uint8Array {
  const dictionary = `{'descr': '<f4', 'fortran_order': False, 'shape': (${shape.join(", ")},), }`;
  const padding = (64 - ((10 + dictionary.length + 1) % 64)) % 64;
  const header = new TextEncoder().encode(`${dictionary}${" ".repeat(padding)}\n`);
  const output = new Uint8Array(10 + header.length + values.length * 4);
  output.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0]);
  new DataView(output.buffer).setUint16(8, header.length, true);
  output.set(header, 10);
  const view = new DataView(output.buffer);
  values.forEach((value, index) => view.setFloat32(10 + header.length + index * 4, value, true));
  return output;
}
