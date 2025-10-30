"use client";

import React, { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

type WizardResult = Record<string, unknown> | null;

function WizardForm() {
  const search = useSearchParams();
  const [owner, setOwner] = useState(() => search.get("owner") ?? "acme");
  const [repo, setRepo] = useState(() => search.get("repo") ?? "roadmap-kit-starter");
  const [branch, setBranch] = useState(() => search.get("branch") ?? "chore/roadmap-setup");
  const [readOnlyUrl, setReadOnlyUrl] = useState(
    () => search.get("readOnlyUrl") ?? "https://<ref>.functions.supabase.co/read_only_checks"
  );
  const [projectSlug, setProjectSlug] = useState(() => search.get("project") ?? "");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WizardResult>(null);

  const submit = async () => {
    setLoading(true);
    setResult(null);
    try {
      const payload: Record<string, unknown> = { owner, repo, branch, readOnlyUrl };
      const trimmedSlug = projectSlug.trim();
      if (trimmedSlug) {
        payload.projectSlug = trimmedSlug;
      }

      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await response.json();
      setResult(json);
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Failed to create PR" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>Onboarding Wizard</h2>
      <div className="form-row">
        <div>
          <label>GitHub Owner</label>
          <input value={owner} onChange={(event) => setOwner(event.target.value)} />
        </div>
        <div>
          <label>Repository</label>
          <input value={repo} onChange={(event) => setRepo(event.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <div>
          <label>Branch name for PR</label>
          <input value={branch} onChange={(event) => setBranch(event.target.value)} />
        </div>
        <div>
          <label>READ_ONLY_CHECKS_URL</label>
          <input value={readOnlyUrl} onChange={(event) => setReadOnlyUrl(event.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <div>
          <label>Project slug (optional)</label>
          <input value={projectSlug} onChange={(event) => setProjectSlug(event.target.value)} />
        </div>
      </div>
      <div style={{ height: 12 }} />
      <button type="button" onClick={submit} disabled={loading}>
        {loading ? "Creating PR…" : "Create Setup PR"}
      </button>
      {result ? (
        <div style={{ marginTop: 12 }}>
          {typeof result === "object" && result && "url" in result && typeof result.url === "string" ? (
            <a href={result.url} target="_blank" rel="noreferrer">
              Open PR
            </a>
          ) : (
            <pre>{JSON.stringify(result, null, 2)}</pre>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function Wizard() {
  return (
    <Suspense fallback={<div className="card">Loading wizard…</div>}>
      <WizardForm />
    </Suspense>
  );
}
