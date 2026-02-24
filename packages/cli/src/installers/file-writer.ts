import { readFile, writeFile, mkdir, access } from "fs/promises";
import { dirname } from "path";
import { createPatch } from "diff";

export enum FileStatus {
  New = "new",
  Identical = "identical",
  Different = "different",
}

export async function checkFileStatus(filePath: string, newContent: string): Promise<FileStatus> {
  try {
    await access(filePath);
  } catch {
    return FileStatus.New;
  }
  const existing = await readFile(filePath, "utf-8");
  return existing === newContent ? FileStatus.Identical : FileStatus.Different;
}

export function generateDiff(filePath: string, oldContent: string, newContent: string): string {
  return createPatch(filePath, oldContent, newContent, "local", "registry");
}

export async function readExistingFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

export async function writeComponentFile(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}
