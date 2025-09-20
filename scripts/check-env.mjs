// scripts/check-env.mjs
import { Buffer } from "node:buffer";

function preview(str, n = 60) {
  if (!str) return "(empty)";
  const safe = str.replace(/\n/g, "\\n");
  return safe.length > n ? safe.slice(0, n) + "…" : safe;
}

console.log("=== GitHub App Env Check ===");
console.log("GH_APP_ID:", process.env.GH_APP_ID || "(missing)");

const b64 = process.env.GH_APP_PRIVATE_KEY_B64;
console.log("GH_APP_PRIVATE_KEY_B64:", b64 ? "present" : "(missing)");
if (b64) {
  const decoded = Buffer.from(b64, "base64").toString("utf8");
  console.log("  decoded preview:", preview(decoded));
}

const pem = process.env.GH_APP_PRIVATE_KEY;
console.log("GH_APP_PRIVATE_KEY:", pem ? "present" : "(missing)");
if (pem) {
  console.log("  preview:", preview(pem));
}

const pat = process.env.GITHUB_TOKEN;
console.log("GITHUB_TOKEN:", pat ? "present" : "(missing)");
if (pat) {
  console.log("  preview:", preview(pat, 12));
}