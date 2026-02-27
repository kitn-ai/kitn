import * as p from "@clack/prompts";
import pc from "picocolors";

interface ChangelogEntry {
  version: string;
  date: string;
  type: string;
  note: string;
}

interface ComponentManifest {
  name: string;
  type: string;
  description: string;
  version: string;
  changelog: ChangelogEntry[];
  [key: string]: unknown;
}

interface ComponentInfo {
  name: string;
  type: string;
  version: string;
  dir: string;
  manifestPath: string;
}

function bumpVersion(version: string, type: "major" | "minor" | "patch"): string {
  const [major, minor, patch] = version.split(".").map(Number);
  switch (type) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

async function scanComponents(): Promise<ComponentInfo[]> {
  const { readdir, readFile } = await import("fs/promises");
  const { join } = await import("path");

  const ROOT = new URL("..", import.meta.url).pathname;
  const COMPONENTS_DIR = join(ROOT, "components");
  const components: ComponentInfo[] = [];

  for (const typeDir of ["agents", "tools", "skills", "storage", "package"]) {
    const dir = join(COMPONENTS_DIR, typeDir);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const componentDir = join(dir, entry);
      const manifestPath = join(componentDir, "manifest.json");
      try {
        const raw = await readFile(manifestPath, "utf-8");
        const manifest: ComponentManifest = JSON.parse(raw);
        components.push({
          name: manifest.name,
          type: typeDir,
          version: manifest.version ?? "1.0.0",
          dir: componentDir,
          manifestPath,
        });
      } catch {
        continue;
      }
    }
  }

  return components.sort((a, b) => a.name.localeCompare(b.name));
}

if (import.meta.main) {
  const { readFile, writeFile } = await import("fs/promises");
  const { spawn } = await import("child_process");

  p.intro(pc.bold("kitn bump"));

  const components = await scanComponents();
  if (components.length === 0) {
    p.log.error("No components found.");
    process.exit(1);
  }

  // Resolve component — from positional arg or interactive picker
  const arg = process.argv[2];
  let component: ComponentInfo;

  if (arg) {
    const found = components.find((c) => c.name === arg);
    if (!found) {
      p.log.error(`Component ${pc.bold(arg)} not found.`);
      p.log.info(`Available: ${components.map((c) => c.name).join(", ")}`);
      process.exit(1);
    }
    component = found;
    p.log.info(`Component: ${pc.bold(component.name)} ${pc.dim(`(${component.version})`)}`);
  } else {
    const selected = await p.select({
      message: "Which component?",
      options: components.map((c) => ({
        value: c.name,
        label: `${c.name} ${pc.dim(`(${c.version})`)}`,
      })),
    });

    if (p.isCancel(selected)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    component = components.find((c) => c.name === selected)!;
  }

  // Version bump type
  const patchVersion = bumpVersion(component.version, "patch");
  const minorVersion = bumpVersion(component.version, "minor");
  const majorVersion = bumpVersion(component.version, "major");

  const bumpType = await p.select({
    message: "Version bump?",
    options: [
      { value: "patch" as const, label: `patch ${pc.dim(`→ ${patchVersion}`)}` },
      { value: "minor" as const, label: `minor ${pc.dim(`→ ${minorVersion}`)}` },
      { value: "major" as const, label: `major ${pc.dim(`→ ${majorVersion}`)}` },
    ],
  });

  if (p.isCancel(bumpType)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const newVersion = bumpVersion(component.version, bumpType);

  // Changelog type — default based on bump type
  const defaultChangeType = bumpType === "major" ? "breaking" : bumpType === "minor" ? "feature" : "fix";

  const changeType = await p.select({
    message: "Change type?",
    initialValue: defaultChangeType,
    options: [
      { value: "feature", label: "feature" },
      { value: "fix", label: "fix" },
      { value: "breaking", label: "breaking" },
    ],
  });

  if (p.isCancel(changeType)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  // Changelog note
  const note = await p.text({
    message: "Changelog note:",
    validate: (value) => {
      if (!value.trim()) return "A changelog note is required.";
    },
  });

  if (p.isCancel(note)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  // Update manifest
  const raw = await readFile(component.manifestPath, "utf-8");
  const manifest: ComponentManifest = JSON.parse(raw);

  manifest.version = newVersion;

  const today = new Date().toISOString().split("T")[0];
  const entry: ChangelogEntry = {
    version: newVersion,
    date: today,
    type: changeType,
    note: note.trim(),
  };

  if (!manifest.changelog) {
    manifest.changelog = [];
  }
  manifest.changelog.unshift(entry);

  await writeFile(component.manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  p.log.success(`Updated ${pc.bold(component.name)}: ${pc.dim(component.version)} → ${pc.green(newVersion)}`);

  // Offer to rebuild
  const rebuild = await p.confirm({
    message: "Rebuild registry?",
    initialValue: true,
  });

  if (p.isCancel(rebuild)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  if (rebuild) {
    const s = p.spinner();
    s.start("Building registry...");

    const buildScript = new URL("./build-registry.ts", import.meta.url).pathname;
    const child = spawn("bun", ["run", buildScript], { stdio: "pipe" });

    let output = "";
    child.stdout.on("data", (data: Buffer) => { output += data.toString(); });
    child.stderr.on("data", (data: Buffer) => { output += data.toString(); });

    const code = await new Promise<number>((resolve) => {
      child.on("close", (code) => resolve(code ?? 1));
    });

    if (code === 0) {
      s.stop("Registry rebuilt.");
    } else {
      s.stop(pc.red("Build failed."));
      p.log.error(output);
      process.exit(1);
    }
  }

  p.outro("Done!");
}
