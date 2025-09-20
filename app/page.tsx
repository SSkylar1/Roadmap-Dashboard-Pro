"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Check = {
  type: string;
  ok?: boolean;           // true, false, or undefined (pending)
  detail?: string;        // optional human message
};

type Item = {
  id?: string;
  name?: string;
  checks?: Check[];
};

type Week = {
  id?: string;
  title?: string;
  items?: Item[];
};

type StatusResponse = {
  generated_at?: string;
  env?: string;
  weeks: Week[];
};

function useStatus(owner: string, repo: string) {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    const url = `/api/status/${owner}/${repo}`;

    setLoading(true);
    fetch(url, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          const msg = body?.message || body?.error || r.statusText || "Failed to load status";
          throw new Error(msg);
        }
        return r.json();
      })
      .then((json: StatusResponse) => {
        if (!cancelled) {
          setData(json);
          setErr(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setErr(String(e?.message || e));
          setData(null);
        }
      })
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [owner, repo]);

  return { data, err, loading };
}

function statusIcon(ok: boolean | undefined) {
  if (ok === true) return "✅";
  if (ok === false) return "❌";
  return "⏳";
}

function classFor(ok: boolean | undefined) {
  if (ok === true) return "bg-green-100 text-green-800 border-green-200";
  if (ok === false) return "bg-red-100 text-red-800 border-red-200";
  return "bg-gray-100 text-gray-700 border-gray-200";
}

function summarizeChecks(checks?: Check[]) {
  const total = checks?.length ?? 0;
  const passed = (checks ?? []).filter((c) => c.ok === true).length;
  const failed = (checks ?? []).filter((c) => c.ok === false).length;
  const pending = total - passed - failed;
  return { total, passed, failed, pending };
}

function WeekProgress({ weeks }: { weeks: Week[] }) {
  const { total, passed, failed, pending } = useMemo(() => {
    let total = 0,
      passed = 0,
      failed = 0,
      pending = 0;
    for (const w of weeks) {
      for (const it of w.items ?? []) {
        const s = summarizeChecks(it.checks);
        total += s.total;
        passed += s.passed;
        failed += s.failed;
        pending += s.pending;
      }
    }
    return { total, passed, failed, pending };
  }, [weeks]);

  if (total === 0) return null;

  const pct = (n: number) => Math.round((n / total) * 100);

  return (
    <div className="mt-4 rounded-xl border p-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Overall Progress</div>
        <div className="text-sm text-gray-600">
          ✅ {passed} • ❌ {failed} • ⏳ {pending} (of {total})
        </div>
      </div>
      <div className="mt-3 h-3 w-full overflow-hidden rounded-full border">
        <div
          className="h-full"
          style={{ width: `${pct(passed)}%` }}
          aria-label="passed"
          title={`Passed: ${passed}`}
        />
        <div
          className="h-full"
          style={{
            width: `${pct(failed)}%`,
            marginTop: "-0.75rem", // stack in same bar
          }}
          aria-label="failed"
          title={`Failed: ${failed}`}
        />
        <div
          className="h-full"
          style={{
            width: `${pct(pending)}%`,
            marginTop: "-0.75rem",
          }}
          aria-label="pending"
          title={`Pending: ${pending}`}
        />
      </div>
      <style jsx>{`
        /* Keep default colors so we don't fight your Tailwind theme.
           Three stacked bars using default matplotlib-like neutrals. */
        div[aria-label="passed"] {
          background: #86efac; /* green-300 */
        }
        div[aria-label="failed"] {
          background: #fca5a5; /* red-300 */
        }
        div[aria-label="pending"] {
          background: #d1d5db; /* gray-300 */
        }
      `}</style>
    </div>
  );
}

function CheckRow({ c }: { c: Check }) {
  return (
    <div
      className={`mb-1 inline-flex items-center gap-2 rounded-lg border px-2 py-1 text-sm ${classFor(
        c.ok
      )}`}
    >
      <span className="leading-none">{statusIcon(c.ok)}</span>
      <span className="leading-none font-medium">{c.type}</span>
      {c.detail ? (
        <span className="leading-none text-xs opacity-80">· {c.detail}</span>
      ) : null}
    </div>
  );
}

function ItemCard({ item }: { item: Item }) {
  const sum = summarizeChecks(item.checks);
  return (
    <div className="rounded-xl border p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-medium">{item.name ?? "Untitled item"}</div>
        <div className="text-xs text-gray-600">
          ✅ {sum.passed} • ❌ {sum.failed} • ⏳ {sum.pending} (of {sum.total})
        </div>
      </div>

      {sum.total === 0 ? (
        <div className="text-sm text-gray-500">No checks yet.</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {(item.checks ?? []).map((c, i) => (
            <CheckRow key={`${c.type}-${i}`} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function WeekCard({ week }: { week: Week }) {
  // roll up week totals
  const rollup = useMemo(() => {
    let total = 0,
      passed = 0,
      failed = 0,
      pending = 0;
    for (const it of week.items ?? []) {
      const s = summarizeChecks(it.checks);
      total += s.total;
      passed += s.passed;
      failed += s.failed;
      pending += s.pending;
    }
    return { total, passed, failed, pending };
  }, [week]);

  return (
    <div className="rounded-2xl border p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-lg font-semibold">{week.title ?? "Untitled week"}</div>
        <div className="text-sm text-gray-600">
          ✅ {rollup.passed} • ❌ {rollup.failed} • ⏳ {rollup.pending} (of {rollup.total})
        </div>
      </div>

      <div className="grid gap-3">
        {(week.items ?? []).map((it, i) => (
          <ItemCard key={`${it.id ?? i}`} item={it} />
        ))}
      </div>
    </div>
  );
}

function DashboardPage() {
  const sp = useSearchParams();
  const owner = sp.get("owner") || "SSkylar1";
  const repo = sp.get("repo") || "Roadmap-Kit-Starter";

  const { data, err, loading } = useStatus(owner, repo);

  return (
    <main className="mx-auto max-w-4xl p-4">
      <h1 className="text-2xl font-bold">Roadmap Dashboard Pro</h1>
      <p className="mt-1 text-sm text-gray-600">
        Onboard repos, view status, edit rc, and verify infra — safely.
      </p>

      <div className="mt-3 text-sm text-gray-700">
        Repo: <span className="font-mono">{owner}/{repo}</span>
      </div>

      {loading && (
        <div className="mt-6 animate-pulse rounded-2xl border p-6 text-gray-500">
          Loading status…
        </div>
      )}

      {err && !loading && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
          <div className="font-semibold">Failed to load status</div>
          <div className="text-sm">{err}</div>
        </div>
      )}

      {data && (
        <>
          <WeekProgress weeks={data.weeks ?? []} />

          <div className="mt-6 grid gap-4">
            {(data.weeks ?? []).map((w, i) => (
              <WeekCard key={`${w.id ?? i}`} week={w} />
            ))}
          </div>

          <div className="mt-6 text-xs text-gray-500">
            Generated at: {data.generated_at ?? "unknown"} · env: {data.env ?? "unknown"}
          </div>
        </>
      )}

      {!loading && !err && (!data || (data.weeks ?? []).length === 0) && (
        <div className="mt-6 rounded-xl border p-6 text-gray-600">
          No weeks found. Make sure your <code>.roadmaprc.json</code> or status API is populated.
        </div>
      )}
    </main>
  );
}

function PageFallback() {
  return (
    <main className="mx-auto max-w-4xl p-4">
      <h1 className="text-2xl font-bold">Roadmap Dashboard Pro</h1>
      <p className="mt-1 text-sm text-gray-600">
        Onboard repos, view status, edit rc, and verify infra — safely.
      </p>
      <div className="mt-6 animate-pulse rounded-2xl border p-6 text-gray-500">Loading dashboard…</div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<PageFallback />}>
      <DashboardPage />
    </Suspense>
  );
}

