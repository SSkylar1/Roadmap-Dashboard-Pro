"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Check = {
  id?: string;
  name?: string;
  type: string;
  ok?: boolean;           // true, false, or undefined (pending)
  detail?: string;        // optional human message
  note?: string;
  status?: string;
  result?: string;
};

type Item = {
  id?: string;
  name?: string;
  checks?: Check[];
  done?: boolean;
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

function statusTone(ok: boolean | undefined, hasChecks: boolean) {
  if (ok === true) return "success";
  if (ok === false) return "fail";
  return hasChecks ? "pending" : "neutral";
}

function statusText(ok: boolean | undefined, hasChecks: boolean) {
  if (ok === true) return "Complete";
  if (ok === false) return "Needs attention";
  return hasChecks ? "In progress" : "No checks yet";
}

function formatResultLabel(result: unknown) {
  if (typeof result !== "string") return null;
  const trimmed = result.trim();
  if (!trimmed) return null;
  return trimmed
    .split(/[_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

type StatusCounts = {
  total: number;
  passed: number;
  failed: number;
  pending: number;
};

function summarizeChecks(checks?: Check[]): StatusCounts {
  const total = checks?.length ?? 0;
  const passed = (checks ?? []).filter((c) => c.ok === true).length;
  const failed = (checks ?? []).filter((c) => c.ok === false).length;
  const pending = total - passed - failed;
  return { total, passed, failed, pending };
}

function formatStatusSummary({ total, passed, failed, pending }: StatusCounts) {
  if (total === 0) return null;
  const parts: string[] = [];
  if (passed > 0) parts.push(`✅ ${passed}`);
  if (failed > 0) parts.push(`❌ ${failed}`);
  if (pending > 0) parts.push(`⏳ ${pending}`);

  if (parts.length === 0) return null;
  return `${parts.join(" • ")}${total > 0 ? ` (of ${total})` : ""}`;
}

function checksStatus(checks?: Check[]): boolean | undefined {
  const arr = checks ?? [];
  if (arr.length === 0) return undefined;
  let pending = false;
  for (const c of arr) {
    if (c.ok === false) return false;
    if (c.ok !== true) pending = true;
  }
  if (pending) return undefined;
  return true;
}

function itemStatus(item: Item): boolean | undefined {
  if (typeof item.done === "boolean") return item.done;
  return checksStatus(item.checks);
}

function weekStatus(week: Week): boolean | undefined {
  const items = week.items ?? [];
  if (items.length === 0) return undefined;
  let pending = false;
  for (const it of items) {
    const st = itemStatus(it);
    if (st === false) return false;
    if (st !== true) pending = true;
  }
  if (pending) return undefined;
  return true;
}

function StatusBadge({
  ok,
  total,
  summary,
}: {
  ok: boolean | undefined;
  total: number;
  summary: string | null;
}) {
  const tone = statusTone(ok, total > 0);
  const label = summary ?? statusText(ok, total > 0);
  return (
    <span className={`status-chip status-${tone}`}>
      <span className="status-chip-icon">{statusIcon(ok)}</span>
      <span className="status-chip-text">{label}</span>
    </span>
  );
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

  const summary = formatStatusSummary({ total, passed, failed, pending });
  const overallStatus = failed > 0 ? false : pending > 0 ? undefined : true;

  return (
    <div className="progress-card">
      <div className="status-row">
        <div className="section-title">Overall Progress</div>
        <StatusBadge ok={overallStatus} total={total} summary={summary} />
      </div>
      <div className="progress-bar" role="presentation">
        <div className="progress-fill passed" style={{ width: `${pct(passed)}%` }} title={`Passed: ${passed}`} />
        <div className="progress-fill failed" style={{ width: `${pct(failed)}%` }} title={`Failed: ${failed}`} />
        <div className="progress-fill pending" style={{ width: `${pct(pending)}%` }} title={`Pending: ${pending}`} />
      </div>
      <div className="progress-legend">✅ {passed} · ❌ {failed} · ⏳ {pending}</div>
    </div>
  );
}

function CheckRow({ c }: { c: Check }) {
  const label = c.name || c.id || c.type || "Check";
  const detail = c.detail ?? c.note ?? null;
  const resultLabel = formatResultLabel(c.result ?? c.status);
  const tone = statusTone(c.ok, true);
  return (
    <li className={`subtask subtask-${tone}`}>
      <div className="subtask-info">
        <div className="subtask-label">{label}</div>
        {detail ? <div className="subtask-detail">{detail}</div> : null}
      </div>
      <div className="subtask-status">
        <span className={`status-chip status-${tone}`}>
          <span className="status-chip-icon">{statusIcon(c.ok)}</span>
          {resultLabel ? <span className="status-chip-text">{resultLabel}</span> : null}
        </span>
      </div>
    </li>
  );
}

function ItemCard({ item }: { item: Item }) {
  const sum = summarizeChecks(item.checks);
  const summary = formatStatusSummary(sum);
  const ok = itemStatus(item);
  const tone = statusTone(ok, sum.total > 0);
  const title = item.name || item.id || "Untitled item";
  const subtitle = item.id && item.id !== item.name ? item.id : null;

  return (
    <div className={`item-card item-${tone}`}>
      <div className="item-header">
        <div className="item-heading">
          <div className="item-title">{title}</div>
          {subtitle ? <div className="item-meta">{subtitle}</div> : null}
        </div>
        <StatusBadge ok={ok} total={sum.total} summary={summary} />
      </div>

      {sum.total > 0 ? (
        <ul className="subtask-list">
          {(item.checks ?? []).map((c, i) => {
            const key = c.id || c.name || c.type || `check-${i}`;
            return <CheckRow key={key} c={c} />;
          })}
        </ul>
      ) : (
        <div className="empty-subtasks">No sub tasks yet.</div>
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

  const summary = formatStatusSummary(rollup);
  const ok = weekStatus(week);
  const tone = statusTone(ok, rollup.total > 0);
  const title = week.title || week.id || "Untitled week";
  const subtitle = week.id && week.id !== week.title ? week.id : null;
  const items = week.items ?? [];

  return (
    <section className={`week-card week-${tone}`}>
      <div className="week-header">
        <div className="week-heading">
          <div className="week-title">{title}</div>
          {subtitle ? <div className="week-meta">{subtitle}</div> : null}
        </div>
        <StatusBadge ok={ok} total={rollup.total} summary={summary} />
      </div>

      {items.length > 0 ? (
        <div className="week-items">
          {items.map((it, i) => (
            <ItemCard key={`${it.id ?? it.name ?? i}`} item={it} />
          ))}
        </div>
      ) : (
        <div className="empty-subtasks">No tasks tracked for this week yet.</div>
      )}
    </section>
  );
}

function DashboardPage() {
  const sp = useSearchParams();
  const owner = sp.get("owner") || "SSkylar1";
  const repo = sp.get("repo") || "Roadmap-Kit-Starter";

  const { data, err, loading } = useStatus(owner, repo);

  return (
    <main className="dashboard">
      <div className="repo-line">
        <span className="repo-label">Repo:</span>
        <code>{owner}/{repo}</code>
        <a href={`/api/status/${owner}/${repo}`} target="_blank" rel="noreferrer">
          View status JSON ↗
        </a>
      </div>

      {loading && <div className="card muted">Loading status…</div>}

      {err && !loading && (
        <div className="card error">
          <div className="card-title">Failed to load status</div>
          <div className="card-subtitle">{err}</div>
          <div className="card-subtitle">Try running the onboarding wizard at <code>/new</code>.</div>
        </div>
      )}

      {data && (
        <>
          <WeekProgress weeks={data.weeks ?? []} />

          <div className="week-grid">
            {(data.weeks ?? []).map((w, i) => (
              <WeekCard key={`${w.id ?? i}`} week={w} />
            ))}
          </div>

          <div className="timestamp">
            Generated at: {data.generated_at ?? "unknown"} · env: {data.env ?? "unknown"}
          </div>
        </>
      )}

      {!loading && !err && (!data || (data.weeks ?? []).length === 0) && (
        <div className="card muted">
          No weeks found. Make sure your <code>.roadmaprc.json</code> or status API is populated.
        </div>
      )}
    </main>
  );
}

function PageFallback() {
  return (
    <main className="dashboard">
      <div className="card muted">Loading dashboard…</div>
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


