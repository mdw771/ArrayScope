import { promises as fs } from "node:fs";
import * as vscode from "vscode";

export interface FileSnapshot {
  size: number;
  mtime: number;
}

export interface RandomAccessReader {
  readonly size: number;
  read(position: number, length: number, signal?: AbortSignal): Promise<Uint8Array>;
  assertUnchanged(signal?: AbortSignal): Promise<void>;
  dispose(): Promise<void>;
}

class NodeFileReader implements RandomAccessReader {
  #disposed = false;
  private constructor(
    readonly uri: vscode.Uri,
    readonly size: number,
    readonly snapshot: FileSnapshot,
    readonly handle: fs.FileHandle,
  ) {}

  static async create(uri: vscode.Uri): Promise<NodeFileReader> {
    const handle = await fs.open(uri.fsPath, "r");
    try {
      const stat = await handle.stat();
      return new NodeFileReader(uri, stat.size, { size: stat.size, mtime: stat.mtimeMs }, handle);
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async read(position: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
    this.assertOpen(signal);
    validateRange(position, length, this.size);
    const output = Buffer.allocUnsafe(length);
    let bytesRead = 0;
    while (bytesRead < length) {
      this.assertOpen(signal);
      const result = await this.handle.read(output, bytesRead, length - bytesRead, position + bytesRead);
      this.assertOpen(signal);
      if (result.bytesRead === 0) throw new Error("Unexpected end of file while reading image data.");
      bytesRead += result.bytesRead;
    }
    return new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
  }

  async assertUnchanged(signal?: AbortSignal): Promise<void> {
    this.assertOpen(signal);
    const stat = await this.handle.stat();
    this.assertOpen(signal);
    if (stat.size !== this.snapshot.size || stat.mtimeMs !== this.snapshot.mtime) {
      throw new Error("The source file changed while it was open. Reopen the editor to reload it safely.");
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    await this.handle.close();
  }

  private assertOpen(signal?: AbortSignal): void {
    if (signal?.aborted) throw abortError();
    if (this.#disposed) throw new Error("The image file reader is already closed.");
  }
}

class WorkspaceFileReader implements RandomAccessReader {
  private constructor(
    readonly uri: vscode.Uri,
    readonly size: number,
    readonly snapshot: FileSnapshot,
    private contents?: Uint8Array,
  ) {}

  static async create(uri: vscode.Uri): Promise<WorkspaceFileReader> {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > 256 * 1024 * 1024) {
      throw new Error(
        `The ${uri.scheme} file system does not support positional reads, and this file is too large for the safe fallback.`,
      );
    }
    const contents = await vscode.workspace.fs.readFile(uri);
    return new WorkspaceFileReader(
      uri,
      stat.size,
      { size: stat.size, mtime: stat.mtime },
      contents,
    );
  }

  async read(position: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
    if (signal?.aborted) throw abortError();
    validateRange(position, length, this.size);
    if (!this.contents) throw new Error("The image file reader is already closed.");
    return this.contents.slice(position, position + length);
  }

  async assertUnchanged(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw abortError();
    if (!this.contents) throw new Error("The image file reader is already closed.");
    const stat = await vscode.workspace.fs.stat(this.uri);
    if (signal?.aborted) throw abortError();
    if (!this.contents) throw new Error("The image file reader is already closed.");
    if (stat.size !== this.snapshot.size || stat.mtime !== this.snapshot.mtime) {
      throw new Error("The source file changed while it was open. Reopen the editor to reload it safely.");
    }
  }

  async dispose(): Promise<void> {
    this.contents = undefined;
  }
}

function abortError(): Error {
  const error = new Error("The image file operation was cancelled.");
  error.name = "AbortError";
  return error;
}

function validateRange(position: number, length: number, size: number): void {
  if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 0) {
    throw new Error("Invalid image byte range.");
  }
  if (position + length > size) throw new Error("Image byte range exceeds the source file.");
}

export async function openRandomAccessReader(uri: vscode.Uri): Promise<RandomAccessReader> {
  return uri.scheme === "file"
    ? NodeFileReader.create(uri)
    : WorkspaceFileReader.create(uri);
}
