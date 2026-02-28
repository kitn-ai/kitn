/**
 * Test skills endpoints — create, list, get, update, delete.
 *
 * Usage: bun scripts/10-skills.ts
 */
import { api, assert, header, info, summary } from "./helpers.js";

header("Skills");

const skillName = `test-skill-${Date.now()}`;

// --- Create a skill ---
info("POST /api/skills — create a skill");
let res = await api("POST", "/api/skills", {
  name: skillName,
  content: [
    "---",
    "name: " + skillName,
    "description: A test skill created by the scripts",
    "---",
    "",
    "# Test Skill",
    "",
    "This is a test skill with sample instructions.",
  ].join("\n"),
});
assert.status(res, 201, "Create skill");

// --- List skills ---
info("GET /api/skills — list skills");
res = await api("GET", "/api/skills");
assert.status(res, 200, "List skills");
assert.contains(res, skillName, "Has our skill");

// --- Get skill ---
info(`GET /api/skills/${skillName}`);
res = await api("GET", `/api/skills/${skillName}`);
assert.status(res, 200, "Get skill");
assert.contains(res, "Test Skill", "Has content");

// --- Update skill ---
info(`PUT /api/skills/${skillName}`);
res = await api("PUT", `/api/skills/${skillName}`, {
  content: [
    "---",
    "name: " + skillName,
    "description: Updated test skill",
    "---",
    "",
    "# Updated Test Skill",
    "",
    "This skill has been updated.",
  ].join("\n"),
});
assert.status(res, 200, "Update skill");

// Verify update
res = await api("GET", `/api/skills/${skillName}`);
assert.contains(res, "Updated", "Skill updated");

// --- Delete skill ---
info(`DELETE /api/skills/${skillName}`);
res = await api("DELETE", `/api/skills/${skillName}`);
assert.status(res, 200, "Delete skill");

// Verify deletion
res = await api("GET", `/api/skills/${skillName}`);
assert.status(res, 404, "Skill deleted");

process.exit(summary());
