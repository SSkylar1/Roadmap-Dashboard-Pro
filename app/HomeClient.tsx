// app/HomeClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Week = { id?: string; title?: string; items?: any[] };

function useStatus(owner: string, repo: string, project?: string | null) {
  const [data, setData] = useState<{ weeks: Week[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (project) {
      params.set("project", project);
    }
    const url = params.toString()
      ? `/api/status/${owner}/${repo}?${params.toString()}`
      : `/api/status/${owner}/${repo}`;
    fetch(url, { cache: "no-store" })
      .then(r => (r.ok ? r.json() : r.json().then(x => Promise.reject(x))))
      .then(json => {
        if (json && typeof json === "object" && "snapshot" in json) {
          setData((json as { snapshot: { weeks: Week[] } }).snapshot);
        } else {
          setData(json as { weeks: Week[] });
        }
      })
      .catch(e => setErr(e?.message || e?.error || "Failed to load status"));
  }, [owner, repo, project]);

  return { data, err };
}

export default function HomeClient() {
  const sp = useSearchParams();
  const owner = sp.get("owner") || "SSkylar1";
  const repo = sp.get("repo") || "Roadmap-Kit-Starter";
  const project = sp.get("project");

  const { data, err } = useStatus(owner, repo, project);
  const weeks = useMemo(() => data?.weeks ?? [], [data]);

  return (
    <main className="mx-auto max-w-4xl p-6 text-slate-200">
      <h1 className="text-3xl font-semibold mb-2">Roadmap Dashboard Pro</h1>
      <p className="mb-6 text-slate-400">
        Repo: <b>{owner}/{repo}</b>{" "}
        <a
          className="underline ml-2 text-slate-400 hover:text-slate-200"
          href={`/api/status/${owner}/${repo}${project ? `?project=${project}` : ""}`}
          target="_blank"
        >
          (view JSON)
        </a>
      </p>

      {!data && !err && <p>Loading…</p>}

      {err && (
        <div className="rounded-lg border border-red-500/40 p-4 text-red-300">
          <p className="font-medium mb-1">Couldn’t load status.</p>
          <p className="text-sm">{err}</p>
          <p className="text-sm mt-2">
            Try the wizard: <a className="underline" href="/new">/new</a>
          </p>
        </div>
      )}

      {weeks.length === 0 && !err && data && (
        <div className="rounded-lg border border-slate-700/40 p-4 text-slate-300">
          <p>No weeks found in your roadmap yet.</p>
          <p className="text-sm text-slate-400 mt-2">Check docs/roadmap.yml</p>
        </div>
      )}

      {weeks.length > 0 && (
        <div className="space-y-6">
          {weeks.map((w, i) => (
            <section key={w.id || i} className="rounded-xl bg-slate-900/50 p-5 border border-slate-700/40">
              <h2 className="text-xl font-medium mb-3">{w.title || w.id}</h2>
              <ul className="space-y-2">
                {(w.items || []).map((it: any, j: number) => (
                  <li key={it.id || j} className="flex items-start gap-3">
                    <span className="mt-1 h-4 w-4 rounded-full bg-slate-600 inline-block" />
                    <div>
                      <div className="font-medium">{it.name || it.id}</div>
                      <div className="text-sm text-slate-400">
                        {(it.checks || []).length} checks
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}