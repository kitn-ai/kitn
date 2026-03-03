// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubRef {
  owner: string;
  repo: string;
  ref: string;
  subdir?: string;
}

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

/**
 * Parse a GitHub reference string into its components.
 *
 * Supported formats:
 * - `github:user/repo`
 * - `github:user/repo#branch`
 * - `github:user/repo/subdir`
 * - `github:user/repo/subdir#branch`
 * - `https://github.com/user/repo`
 * - `https://github.com/user/repo/tree/branch/subdir`
 */
export function parseGitHubUrl(input: string): GitHubRef {
  // Shorthand: github:user/repo[/subdir][#branch]
  if (input.startsWith("github:")) {
    const rest = input.slice("github:".length);
    let ref = "main";

    // Split on # for branch
    const [pathPart, refPart] = rest.split("#");
    if (refPart) ref = refPart;

    const segments = pathPart.split("/").filter(Boolean);
    if (segments.length < 2) {
      throw new Error(
        `Invalid GitHub shorthand: "${input}". Expected github:owner/repo`,
      );
    }

    const [owner, repo, ...subdirParts] = segments;
    return {
      owner,
      repo,
      ref,
      subdir: subdirParts.length > 0 ? subdirParts.join("/") : undefined,
    };
  }

  // Full URL: https://github.com/user/repo[/tree/branch/subdir]
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(
      `Invalid GitHub URL: "${input}". Use github:owner/repo or https://github.com/owner/repo`,
    );
  }

  if (url.hostname !== "github.com") {
    throw new Error(
      `Not a GitHub URL: "${input}". Only github.com is supported.`,
    );
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    throw new Error(
      `Invalid GitHub URL: "${input}". Expected https://github.com/owner/repo`,
    );
  }

  const [owner, repo] = segments;

  // https://github.com/user/repo/tree/branch/subdir
  if (segments.length >= 4 && segments[2] === "tree") {
    const ref = segments[3];
    const subdirParts = segments.slice(4);
    return {
      owner,
      repo,
      ref,
      subdir: subdirParts.length > 0 ? subdirParts.join("/") : undefined,
    };
  }

  return { owner, repo, ref: "main" };
}

// ---------------------------------------------------------------------------
// Tarball fetching
// ---------------------------------------------------------------------------

/**
 * Fetch a GitHub repository tarball.
 *
 * Uses codeload.github.com which doesn't require authentication
 * and has no rate limits for public repos.
 */
export async function fetchGitHubTarball(ref: GitHubRef): Promise<Buffer> {
  const url = `https://codeload.github.com/${ref.owner}/${ref.repo}/tar.gz/${ref.ref}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch template from GitHub: ${response.status} ${response.statusText} (${url})`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
