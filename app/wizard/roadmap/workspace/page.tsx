"use client";

import {
  ChangeEvent,
  FormEvent,
  Suspense,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { load } from "js-yaml";

type ErrorState = { title: string; detail?: string } | null;
type SuccessState = {
  created: string[];
  skipped: string[];
  owner: string;
  repo: string;
} | null;

type UploadState = {
  name: string;
  sizeLabel: string;
};

type ImportResponse = {
  ok: boolean;
  created?: string[];
  skipped?: string[];
  error?: string;
  detail?: string;
};

function formatBytes(bytes: number) {
  if (Number.isNaN(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value < 10 && unitIndex > 0 ? 1 : 0;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function RoadmapProvisionerInner() {
  const params = useSearchParams();
  const [owner, setOwner] = useState(() => params.get("owner") ?? "");
  const [repo, setRepo] = useState(() => params.get("repo") ?? "");
  const [branch, setBranch] = useState(() => params.get("branch") ?? "main");
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [roadmap, setRoadmap] = useState("");
  const [error, setError] = useState<ErrorState>(null);
  const [success, setSuccess] = useState<SuccessState>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadKey, setUploadKey] = useState(0);

  const roadmapPreview = useMemo(() => roadmap.trim(), [roadmap]);
  const hasRoadmap = Boolean(roadmapPreview);
  const canSubmit = Boolean(!isSubmitting && owner && repo && hasRoadmap);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      setUpload(null);
      setRoadmap("");
      setSuccess(null);
      setUploadKey((value) => value + 1);
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setError({ title: "File too large", detail: "Limit uploads to 2MB roadmap files." });
      event.target.value = "";
      setUpload(null);
      setRoadmap("");
      setUploadKey((value) => value + 1);
      return;
    }

    try {
      const text = await file.text();
      if (!text.trim()) {
        throw new Error("Roadmap file is empty");
      }
      load(text);
      setRoadmap(text.trimEnd());
      setUpload({ name: file.name, sizeLabel: formatBytes(file.size) });
      setError(null);
      setSuccess(null);
    } catch (err: any) {
      setError({ title: "Invalid roadmap.yml", detail: err?.message ?? String(err) });
      setUpload(null);
      setRoadmap("");
      setUploadKey((value) => value + 1);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      setError({ title: "Provide required fields", detail: "Upload a roadmap and fill owner/repo before continuing." });
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/roadmap/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repo, branch, roadmap }),
      });

      const payload = (await response.json()) as ImportResponse;
      if (!response.ok || !payload?.ok) {
        const title = payload?.error ?? "Failed to import roadmap";
        setError({ title, detail: payload?.detail });
        return;
      }

      setSuccess({
        created: payload.created ?? [],
        skipped: payload.skipped ?? [],
        owner,
        repo,
      });
    } catch (err: any) {
      setError({ title: "Request failed", detail: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsSubmitting(false);
    }
  }

  const dashboardHref = success && success.owner && success.repo
    ? `/?owner=${encodeURIComponent(success.owner.trim())}&repo=${encodeURIComponent(success.repo.trim())}`
    : null;

  return (
    <div className="tw-space-y-10">
      <header className="tw-space-y-3">
        <span className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-800 tw-px-3 tw-py-1 tw-text-xs tw-font-medium tw-uppercase tw-tracking-wide tw-text-slate-300">
          Roadmap provisioning
        </span>
        <h1 className="tw-text-3xl tw-font-bold tw-leading-tight tw-text-slate-100">
          Import roadmap.yml and scaffold automations
        </h1>
        <p className="tw-text-base tw-leading-relaxed tw-text-slate-300">
          Upload your finalized roadmap to sync docs/roadmap.yml, then generate the foundational artifacts that power status checks and team context.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="tw-grid tw-gap-8 lg:tw-grid-cols-[2fr,1fr]">
        <section className="tw-space-y-6 tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-8">
          <div className="tw-grid tw-gap-4 md:tw-grid-cols-3">
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
          </div>

          <div className="tw-space-y-3">
            <label htmlFor="roadmap-upload" className="tw-block tw-text-sm tw-font-medium tw-text-slate-200">
              Upload docs/roadmap.yml
            </label>
            <input
              key={uploadKey}
              id="roadmap-upload"
              type="file"
              accept=".yml,.yaml"
              onChange={handleFileChange}
              className="tw-w-full tw-rounded-xl tw-border tw-border-dashed tw-border-slate-700 tw-bg-slate-950 tw-px-3 tw-py-3 tw-text-sm tw-text-slate-300 focus:tw-border-slate-500 focus:tw-outline-none"
            />
            {upload ? (
              <div className="tw-flex tw-items-center tw-justify-between tw-rounded-xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-px-4 tw-py-3">
                <div>
                  <p className="tw-text-sm tw-font-medium tw-text-slate-100">{upload.name}</p>
                  <p className="tw-text-xs tw-text-slate-400">{upload.sizeLabel}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setUpload(null);
                    setRoadmap("");
                    setSuccess(null);
                    setUploadKey((value) => value + 1);
                  }}
                  className="tw-text-xs tw-font-semibold tw-text-slate-300 hover:tw-text-slate-100"
                >
                  Remove
                </button>
              </div>
            ) : (
              <p className="tw-text-xs tw-text-slate-400">
                Accepts .yml or .yaml files up to 2MB. We validate the file with js-yaml before committing it to your repository.
              </p>
            )}
          </div>

          {hasRoadmap ? (
            <div className="tw-space-y-2">
              <div className="tw-flex tw-items-center tw-justify-between">
                <h2 className="tw-text-base tw-font-semibold tw-text-slate-200">Preview</h2>
                <span className="tw-text-xs tw-font-medium tw-text-emerald-400">Validated ✓</span>
              </div>
              <pre className="tw-max-h-72 tw-overflow-auto tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-p-4 tw-text-xs tw-leading-relaxed tw-text-slate-200">
                <code>{roadmapPreview}</code>
              </pre>
            </div>
          ) : null}

          {error ? (
            <div className="tw-rounded-2xl tw-border tw-border-rose-800 tw-bg-rose-950/40 tw-p-4">
              <h3 className="tw-text-sm tw-font-semibold tw-text-rose-200">{error.title}</h3>
              {error.detail ? <p className="tw-text-xs tw-text-rose-300 tw-mt-1">{error.detail}</p> : null}
            </div>
          ) : null}

          {success ? (
            <div className="tw-rounded-2xl tw-border tw-border-emerald-700 tw-bg-emerald-950/40 tw-p-4 tw-space-y-2">
              <h3 className="tw-text-sm tw-font-semibold tw-text-emerald-200">Roadmap imported successfully</h3>
              <p className="tw-text-xs tw-text-emerald-100">
                Created {success.created.length} files{success.skipped.length ? `, skipped ${success.skipped.length} existing` : ""}.
              </p>
              {dashboardHref ? (
                <Link
                  href={dashboardHref}
                  className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-emerald-500 tw-bg-emerald-600/10 tw-px-3 tw-py-1.5 tw-text-xs tw-font-semibold tw-text-emerald-100 hover:tw-bg-emerald-600/20"
                >
                  View dashboard
                  <span aria-hidden="true">↗</span>
                </Link>
              ) : null}
            </div>
          ) : null}

          <div className="tw-flex tw-items-center tw-gap-3">
            <button
              type="submit"
              disabled={!canSubmit}
              className="tw-inline-flex tw-items-center tw-justify-center tw-rounded-full tw-bg-slate-100 tw-px-5 tw-py-2.5 tw-text-sm tw-font-semibold tw-text-slate-900 tw-transition tw-duration-200 tw-ease-out disabled:tw-cursor-not-allowed disabled:tw-bg-slate-500/50"
            >
              {isSubmitting ? "Importing…" : "Import & scaffold"}
            </button>
            <p className="tw-text-xs tw-text-slate-400">
              We will commit docs/roadmap.yml and scaffold supporting artifacts directly to {branch}.
            </p>
          </div>
        </section>

        <aside className="tw-space-y-6 tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-p-8">
          <div className="tw-space-y-2">
            <h2 className="tw-text-lg tw-font-semibold tw-text-slate-100">What gets created</h2>
            <p className="tw-text-sm tw-text-slate-300">
              In addition to syncing docs/roadmap.yml, we provision supporting files that keep your roadmap connected to infra, tech stack, and automation workflows.
            </p>
          </div>
          <ul className="tw-space-y-4">
            <li className="tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-4">
              <h3 className="tw-text-sm tw-font-semibold tw-text-slate-100">docs/infra-facts.md</h3>
              <p className="tw-text-xs tw-text-slate-300">
                Capture deployment constraints, database configuration, and escalation paths so handoffs stay smooth once build work begins.
              </p>
            </li>
            <li className="tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-4">
              <h3 className="tw-text-sm tw-font-semibold tw-text-slate-100">docs/tech-stack.yml</h3>
              <p className="tw-text-xs tw-text-slate-300">
                Fill in frameworks, services, and integrations to give AI copilots and collaborators a consistent view of your stack.
              </p>
            </li>
            <li className="tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-4">
              <h3 className="tw-text-sm tw-font-semibold tw-text-slate-100">.github/workflows/roadmap.yml</h3>
              <p className="tw-text-xs tw-text-slate-300">
                Runs roadmap checks on pushes and pull requests, wiring status updates into the dashboard.
              </p>
            </li>
          </ul>
          <div className="tw-rounded-2xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-4 tw-space-y-2">
            <h3 className="tw-text-sm tw-font-semibold tw-text-slate-100">Need the dashboard link?</h3>
            <p className="tw-text-xs tw-text-slate-300">
              After import, jump straight to the live dashboard for this repository to confirm status feeds and roadmap context are flowing.
            </p>
            {dashboardHref ? (
              <Link
                href={dashboardHref}
                className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-700 tw-bg-slate-900 tw-px-3 tw-py-1.5 tw-text-xs tw-font-semibold tw-text-slate-200 hover:tw-border-slate-500"
              >
                Open {success?.owner}/{success?.repo}
                <span aria-hidden="true">↗</span>
              </Link>
            ) : (
              <p className="tw-text-xs tw-text-slate-500">Link will appear after a successful import.</p>
            )}
          </div>
        </aside>
      </form>
    </div>
  );
}

function RoadmapProvisionerPage() {
  return (
    <Suspense fallback={<div className="tw-text-slate-300">Loading roadmap wizard…</div>}>
      <RoadmapProvisionerInner />
    </Suspense>
  );
}

export default RoadmapProvisionerPage;
