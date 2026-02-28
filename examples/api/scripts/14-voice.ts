/**
 * Test voice endpoints — providers, speakers, TTS (speak), STT (transcribe).
 * Requires OPENAI_API_KEY or GROQ_API_KEY to be configured.
 *
 * Usage: bun scripts/14-voice.ts
 */
import { api, assert, header, info, summary } from "./helpers.js";

const BASE_URL = process.env.KITN_BASE_URL ?? "http://localhost:4000";
const API_KEY = process.env.KITN_API_KEY ?? "demo";

header("Voice");

// --- Check if voice is available ---
info("GET /api/voice/providers — list providers");
let res = await api("GET", "/api/voice/providers");
if (res.status !== 200) {
  assert.skip("Voice not enabled — set OPENAI_API_KEY or GROQ_API_KEY");
  process.exit(summary());
}
assert.status(res, 200, "List providers");
assert.contains(res, "providers", "Has providers array");

// --- List speakers ---
info("GET /api/voice/speakers — list available voices");
res = await api("GET", "/api/voice/speakers");
assert.status(res, 200, "List speakers");
assert.contains(res, "speakers", "Has speakers array");

// --- Text-to-speech ---
info("POST /api/voice/speak — generate speech");
const ttsRes = await fetch(`${BASE_URL}/api/voice/speak`, {
  method: "POST",
  headers: {
    "X-API-Key": API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    text: "Hello from kitn voice test.",
    save: true,
  }),
});
assert.ok(ttsRes.status === 200, "TTS success");
const contentType = ttsRes.headers.get("content-type") ?? "";
assert.ok(
  contentType.includes("audio") || contentType.includes("octet"),
  `Audio content type (${contentType})`,
);
const audioId = ttsRes.headers.get("x-audio-id");
// Consume the body
await ttsRes.arrayBuffer();

if (audioId) {
  // --- Retrieve saved audio ---
  info(`GET /api/voice/audio/${audioId} — retrieve saved audio`);
  res = await api("GET", `/api/voice/audio/${audioId}`);
  assert.status(res, 200, "Retrieve audio");

  // --- List audio files ---
  info("GET /api/voice/audio — list audio files");
  res = await api("GET", "/api/voice/audio");
  assert.status(res, 200, "List audio");

  // --- Delete audio ---
  info(`DELETE /api/voice/audio/${audioId}`);
  res = await api("DELETE", `/api/voice/audio/${audioId}`);
  assert.status(res, 200, "Delete audio");
}

process.exit(summary());
