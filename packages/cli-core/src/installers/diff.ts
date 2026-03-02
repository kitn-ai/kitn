import { createPatch } from "diff";

export enum FileStatus {
  New = "new",
  Identical = "identical",
  Different = "different",
}

export function generateDiff(filePath: string, oldContent: string, newContent: string): string {
  return createPatch(filePath, oldContent, newContent, "local", "registry");
}
