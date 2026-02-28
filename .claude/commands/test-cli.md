# Test CLI Changes

Run this after making changes to `packages/cli/` to verify everything works.

---

## Step 1: Build and static checks

Run these in parallel:

```bash
bun run --cwd packages/cli build
bun run typecheck
bun run --cwd packages/cli test
```

All must pass before proceeding.

## Step 2: Integration test in test-projects/sample-app

The `test-projects/` directory is gitignored and used for manual CLI integration testing.

### Setup (if sample-app doesn't exist)

```bash
mkdir -p test-projects/sample-app && cd test-projects/sample-app
bun ../../packages/cli/dist/index.js init
```

### Test commands

Run from `test-projects/sample-app/`. Use the built CLI at `../../packages/cli/dist/index.js`.

**Test `kitn list`:**
```bash
bun ../../packages/cli/dist/index.js list
```
Should display available components grouped by type with install status.

**Test `kitn add`:**
```bash
bun ../../packages/cli/dist/index.js add weather-agent
```
Should resolve dependencies, write files, and update `kitn.lock` (NOT `kitn.json`).

Verify:
```bash
# kitn.json should have NO "installed" key
node -e "const c=JSON.parse(require('fs').readFileSync('kitn.json','utf-8')); console.log('installed' in c ? 'FAIL: kitn.json has installed key' : 'PASS: kitn.json clean');"

# kitn.lock should exist with entries
node -e "const l=JSON.parse(require('fs').readFileSync('kitn.lock','utf-8')); console.log('PASS: kitn.lock has', Object.keys(l).length, 'entries');"
```

**Test `kitn list --installed`:**
```bash
bun ../../packages/cli/dist/index.js list --installed
```
Should show only installed components (read from `kitn.lock`).

**Test `kitn diff`:**
```bash
bun ../../packages/cli/dist/index.js diff weather-agent
```
Should show no differences (or show diff if local files were modified).

**Test `kitn remove`:**
```bash
bun ../../packages/cli/dist/index.js remove weather-agent
```
Should prompt for confirmation, delete files, update `kitn.lock`.

**Test `kitn update`:**
```bash
bun ../../packages/cli/dist/index.js update
```
Should re-fetch all installed components from registry.

## Step 3: Report

Report which commands passed/failed and any issues found.
