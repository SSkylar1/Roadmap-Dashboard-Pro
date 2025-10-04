"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";

import StatusGrid from "@/components/StatusGrid";

type ErrorState = { title: string; detail?: string } | null;

type RunResponse = {
  ok?: boolean;
  wrote?: string[];
  error?: string;
  detail?: string;
};

type BacklogItem = {
  id: string;
  title: string;
  status: string;
};

type DiscoverResponse = {
  ok?: boolean;
  discovered?: number;
  items?: BacklogItem[];
  wrote?: string[];
  error?: string;
  detail?: string;
};

type RoadmapStatus = {
  generated_at?: string;
  weeks?: any[];
};

export default function MidProjectSyncWorkspace() {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [probeUrl, setProbeUrl] = useState("");

  const [status, setStatus] = useState<RoadmapStatus | null>(null);
  const [backlog, setBacklog] = useState<BacklogItem[]>([]);
  const [runArtifacts, setRunArtifacts] = useState<string[]>([]);
  const [discoverArtifacts, setDiscoverArtifacts] = useState<string[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const [error, setError] = useState<ErrorState>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const repoSlug = useMemo(() => {
    const o = owner.trim();
    const r = repo.trim();
    return o && r ? `${o}/${r}` : null;
  }, [owner, repo]);

  const canSubmit = Boolean(!isSyncing && repoSlug);

  async function handleSync(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!repoSlug) {
      setError({ title: "Provide owner and repository", detail: "Fill both fields before connecting." });
      return;
    }

    setIsSyncing(true);
    setError(null);
    setStatus(null);
    setBacklog([]);
    setRunArtifacts([]);
    setDiscoverArtifacts([]);

    const payload = {
      owner: owner.trim(),
      repo: repo.trim(),
      branch: branch.trim() || "main",
      ...(probeUrl.trim() ? { probeUrl: probeUrl.trim() } : {}),
    };

    try {
      const runResponse = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const runJson = (await runResponse.json()) as RunResponse;
      if (!runResponse.ok || runJson?.ok === false || runJson?.error) {
        throw new Error(runJson?.error || "Failed to refresh roadmap status");
      }
      setRunArtifacts(runJson?.wrote ?? []);

      const statusResponse = await fetch(
        `/api/status/${payload.owner}/${payload.repo}?branch=${encodeURIComponent(payload.branch)}`,
        { cache: "no-store" },
      );
      if (statusResponse.ok) {
        const statusJson = (await statusResponse.json()) as RoadmapStatus;
        setStatus(statusJson);
      } else {
        setStatus(null);
      }

      const discoverResponse = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const discoverJson = (await discoverResponse.json()) as DiscoverResponse;
      if (!discoverResponse.ok || discoverJson?.ok === false || discoverJson?.error) {
        throw new Error(discoverJson?.error || "Discover run failed");
      }
      setDiscoverArtifacts(discoverJson?.wrote ?? []);
      setBacklog(discoverJson?.items ?? []);

      setLastSyncedAt(new Date().toISOString());
    } catch (err: any) {
      setError({
        title: "Sync failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsSyncing(false);
    }
  }

  const statusGeneratedAt = status?.generated_at
    ? new Date(status.generated_at).toLocaleString()
    : lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleString()
    : null;

  return (
    <div className="tw-space-y-10">
      <div>
        <Link
          href="/wizard/mid-build"
          className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-3 tw-py-1 tw-text-xs tw-font-medium tw-uppercase tw-tracking-wide tw-text-slate-300 hover:tw-border-slate-700 hover:tw-text-slate-100"
        >
          <span aria-hidden="true">←</span>
          <span>Back to mid-project playbook</span>
        </Link>
      </div>

      <header className="tw-space-y-3">
        <span className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-800 tw-px-3 tw-py-1 tw-text-xs tw-font-medium tw-uppercase tw-tracking-wide tw-text-slate-300">
          Mid-project sync
        </span>
        <h1 className="tw-text-3xl tw-font-bold tw-leading-tight tw-text-slate-100">Refresh live project context</h1>
        <p className="tw-text-base tw-leading-relaxed tw-text-slate-300">
          Connect an active repository to regenerate roadmap status and discovery insights before diving into the full dashboard.
        </p>
      </header>

      <form onSubmit={handleSync} className="tw-grid tw-gap-8 lg:tw-grid-cols-[1.4fr,1fr]">
        <section className="tw-space-y-6 tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-8">
          <div className="tw-grid tw-gap-4 md:tw-grid-cols-2">
            <label className="tw-flex tw-flex-col tw-gap-2">
              <span className="tw-text-sm tw-font-medium tw-text-slate-200">Owner</span>
              <input
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                placeholder="acme-co"
                className="tw-w-full tw-rounded-xl tw-border tw-border-slate-700 tw-bg-slate-950 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-100 tw-placeholder-slate-500 focus:tw-border-slate-500 focus:tw-outline-none"
              />
            </label>
            <label className="tw-flex tw-flex-col tw-gap-2">
              <span className="tw-text-sm tw-font-medium tw-text-slate-200">Repository</span>
              <input
                value={repo}
                onChange={(event) => setRepo(event.target.value)}
                placeholder="product-app"
                className="tw-w-full tw-rounded-xl tw-border tw-border-slate-700 tw-bg-slate-950 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-100 tw-placeholder-slate-500 focus:tw-border-slate-500 focus:tw-outline-none"
              />
            </label>
            <label className="tw-flex tw-flex-col tw-gap-2">
              <span className="tw-text-sm tw-font-medium tw-text-slate-200">Branch</span>
              <input
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder="main"
                className="tw-w-full tw-rounded-xl tw-border tw-border-slate-700 tw-bg-slate-950 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-100 tw-placeholder-slate-500 focus:tw-border-slate-500 focus:tw-outline-none"
              />
            </label>
            <label className="tw-flex tw-flex-col tw-gap-2">
              <span className="tw-text-sm tw-font-medium tw-text-slate-200">Supabase probe URL (optional)</span>
              <input
                value={probeUrl}
                onChange={(event) => setProbeUrl(event.target.value)}
                placeholder="https://.../rest/v1/rpc/roadmap_probe"
                className="tw-w-full tw-rounded-xl tw-border tw-border-slate-700 tw-bg-slate-950 tw-px-3 tw-py-2 tw-text-sm tw-text-slate-100 tw-placeholder-slate-500 focus:tw-border-slate-500 focus:tw-outline-none"
              />
            </label>
          </div>

          <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-4">
            <div className="tw-text-sm tw-text-slate-400">
              {statusGeneratedAt ? (
                <span>Last synced {statusGeneratedAt}</span>
              ) : (
                <span>Run discovery to generate the latest status and backlog files.</span>
              )}
            </div>
            <button
              type="submit"
              className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-bg-slate-100 tw-px-5 tw-py-2 tw-text-sm tw-font-semibold tw-text-slate-900 tw-transition tw-duration-200 tw-ease-out hover:tw-bg-slate-200 disabled:tw-cursor-not-allowed disabled:tw-bg-slate-700 disabled:tw-text-slate-400"
              disabled={!canSubmit}
            >
              {isSyncing ? "Syncing…" : "Connect and sync"}
            </button>
          </div>

          {error ? (
            <div className="tw-rounded-2xl tw-border tw-border-red-500/40 tw-bg-red-500/10 tw-p-4 tw-text-sm tw-text-red-100">
              <div className="tw-font-semibold">{error.title}</div>
              {error.detail ? <div className="tw-text-red-100/80">{error.detail}</div> : null}
            </div>
          ) : null}
        </section>

        <aside className="tw-space-y-4 tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-8">
          <h2 className="tw-text-xl tw-font-semibold tw-text-slate-100">What this sync runs</h2>
          <ul className="tw-space-y-3 tw-text-sm tw-text-slate-300 tw-list-disc tw-pl-5">
            <li>
              <span className="tw-font-medium tw-text-slate-100">/api/run</span> regenerates docs/roadmap-status.json and project-plan context.
            </li>
            <li>
              <span className="tw-font-medium tw-text-slate-100">/api/discover</span> looks for completed work outside the roadmap and updates docs/backlog-discovered.yml.
            </li>
            <li>Bring a Supabase probe URL to surface database checks along with code signals.</li>
          </ul>
          {repoSlug ? (
            <Link
              href={`/${repoSlug}`}
              className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-700 tw-bg-slate-900 tw-px-4 tw-py-2 tw-text-sm tw-font-semibold tw-text-slate-200 tw-transition tw-duration-200 tw-ease-out hover:tw-border-slate-600 hover:tw-text-slate-100"
            >
              <span>Open {repoSlug} dashboard</span>
              <span aria-hidden="true">↗</span>
            </Link>
          ) : null}
        </aside>
      </form>

      <section className="tw-grid tw-gap-6 xl:tw-grid-cols-2">
        <div
          id="discover"
          className="tw-space-y-4 tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-8"
        >
          <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
            <div>
              <h2 className="tw-text-xl tw-font-semibold tw-text-slate-100">Roadmap status</h2>
              <p className="tw-text-sm tw-text-slate-300">Snapshot of docs/roadmap-status.json after the latest run.</p>
            </div>
            {statusGeneratedAt ? (
              <span className="tw-rounded-full tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-3 tw-py-1 tw-text-xs tw-font-medium tw-text-slate-400">
                {statusGeneratedAt}
              </span>
            ) : null}
          </div>
          {status?.weeks?.length ? (
            <StatusGrid status={status} />
          ) : (
            <div className="tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-4 tw-py-8 tw-text-center tw-text-sm tw-text-slate-400">
              Run the sync to populate the roadmap status grid.
            </div>
          )}
        </div>

        <div className="tw-space-y-4 tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-8">
          <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
            <div>
              <h2 className="tw-text-xl tw-font-semibold tw-text-slate-100">Backlog discoveries</h2>
              <p className="tw-text-sm tw-text-slate-300">Preview of docs/backlog-discovered.yml entries to triage.</p>
            </div>
            {discoverArtifacts.length ? (
              <span className="tw-rounded-full tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-3 tw-py-1 tw-text-xs tw-font-medium tw-text-slate-400">
                {discoverArtifacts.length} files touched
              </span>
            ) : null}
          </div>
          {backlog.length ? (
            <ul className="tw-space-y-3">
              {backlog.map((item) => (
                <li
                  key={item.id}
                  className="tw-flex tw-items-start tw-gap-3 tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-p-4"
                >
                  <span className="tw-text-lg" aria-hidden="true">
                    {item.status === "complete" ? "✅" : "•"}
                  </span>
                  <div className="tw-space-y-1">
                    <p className="tw-text-sm tw-font-semibold tw-text-slate-100">{item.title}</p>
                    <p className="tw-text-xs tw-uppercase tw-tracking-wide tw-text-slate-400">{item.id}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-4 tw-py-8 tw-text-center tw-text-sm tw-text-slate-400">
              Discover runs will surface completed work that never landed on the roadmap.
            </div>
          )}
        </div>

        <div className="tw-space-y-4 tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-8 xl:tw-col-span-2">
          <h2 className="tw-text-xl tw-font-semibold tw-text-slate-100">Artifacts updated</h2>
          <div className="tw-grid tw-gap-4 md:tw-grid-cols-2">
            <div className="tw-space-y-2">
              <h3 className="tw-text-sm tw-font-semibold tw-text-slate-200">Status run</h3>
              {runArtifacts.length ? (
                <ul className="tw-space-y-1 tw-text-sm tw-text-slate-300">
                  {runArtifacts.map((path) => (
                    <li key={path} className="tw-rounded-xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-3 tw-py-2">
                      {path}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="tw-text-sm tw-text-slate-400">Run the sync to regenerate roadmap artifacts.</p>
              )}
            </div>
            <div className="tw-space-y-2">
              <h3 className="tw-text-sm tw-font-semibold tw-text-slate-200">Discover run</h3>
              {discoverArtifacts.length ? (
                <ul className="tw-space-y-1 tw-text-sm tw-text-slate-300">
                  {discoverArtifacts.map((path) => (
                    <li key={path} className="tw-rounded-xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-3 tw-py-2">
                      {path}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="tw-text-sm tw-text-slate-400">Run discovery to surface backlog entries and summary docs.</p>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
