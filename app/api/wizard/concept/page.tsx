"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function WizardConceptContent() {
  const router = useRouter();
  const sp = useSearchParams();
  const workspaceId = sp.get("workspaceId");
  const [format, setFormat] = useState<"yaml" | "json">("yaml");
  const [source, setSource] = useState("");

  async function handleSave() {
    const res = await fetch("/api/roadmaps/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, format, source }),
    });
    const j = await res.json();
    if (!res.ok) {
      alert(`Error: ${j.error}\n${j.detail ? JSON.stringify(j.detail, null, 2) : ""}`);
      return;
    }
    if (workspaceId) {
      router.push(`/workspace/${workspaceId}/roadmap`);
    }
  }

  if (!workspaceId) {
    return (
      <div className="rounded border p-3 text-sm">
        Missing workspace. Provide a workspaceId query parameter to load this
        tool.
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-3">
      <h1 className="text-xl font-semibold">Paste/Upload Roadmap</h1>
      <div className="space-x-2">
        <label>
          <input
            type="radio"
            checked={format === "yaml"}
            onChange={() => setFormat("yaml")}
          />
          YAML
        </label>
        <label>
          <input
            type="radio"
            checked={format === "json"}
            onChange={() => setFormat("json")}
          />
          JSON
        </label>
      </div>
      <textarea
        className="h-80 w-full border p-2 font-mono"
        placeholder={
          format === "yaml"
            ? "title: ...\nphases:\n  - name: ..."
            : '{ "title": "...", "phases": [...] }'
        }
        value={source}
        onChange={(e) => setSource(e.target.value)}
      />
      <button onClick={handleSave} className="border px-3 py-2">
        Validate &amp; Save
      </button>
    </div>
  );
}

export default function WizardConcept() {
  return (
    <Suspense fallback={<div className="p-3 text-sm">Loading…</div>}>
      <WizardConceptContent />
    </Suspense>
  );
}
