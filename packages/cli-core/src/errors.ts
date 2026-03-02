export class NotInitializedError extends Error {
  readonly code = "NOT_INITIALIZED" as const;
  readonly cwd: string;
  constructor(cwd: string) {
    super(`No kitn.json found in ${cwd}. Run "kitn init" first.`);
    this.name = "NotInitializedError";
    this.cwd = cwd;
  }
}
