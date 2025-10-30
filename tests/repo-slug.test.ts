import test from "node:test";
import assert from "node:assert/strict";

import { formatRepoSlug, matchesRepoSlugConfirmation } from "../lib/repo-slug";

test("formatRepoSlug builds owner/repo slugs and project suffix", () => {
  assert.equal(
    formatRepoSlug({ owner: "octo", repo: "roadmap" }),
    "octo/roadmap",
  );

  assert.equal(
    formatRepoSlug({ owner: "octo", repo: "roadmap", project: "Alpha Release" }),
    "octo/roadmap#alpha-release",
  );
});

test("matchesRepoSlugConfirmation enforces slug acknowledgement", () => {
  const repo = { owner: "acme", repo: "widget", project: "beta" };
  assert.equal(matchesRepoSlugConfirmation("acme/widget#beta", repo), true);
  assert.equal(matchesRepoSlugConfirmation("ACME/WIDGET#BETA", repo), true);
  assert.equal(matchesRepoSlugConfirmation("acme/widget", repo), false);
  assert.equal(matchesRepoSlugConfirmation("", repo), false);
});
