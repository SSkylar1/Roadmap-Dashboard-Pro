"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
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

const enum CopyState {
  Idle = "idle",
  Copied = "copied",
  Error = "error",
}

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

function itemTitle(item: Item) {
  const title = typeof item.name === "string" && item.name.trim() ? item.name.trim() : null;
  const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : null;
  if (title) return { title, meta: id && id !== title ? id : null };
  if (id) return { title: id, meta: null };
  return { title: "Untitled item", meta: null };
}

function weekTitle(week: Week | undefined) {
  if (!week) return { title: "Untitled week", meta: null };
  const title = typeof week.title === "string" && week.title.trim() ? week.title.trim() : null;
  const id = typeof week.id === "string" && week.id.trim() ? week.id.trim() : null;
  if (title) return { title, meta: id && id !== title ? id : null };
  if (id) return { title: id, meta: null };
  return { title: "Untitled week", meta: null };
}

function friendlyCheckResult(check: Check) {
  const label = formatResultLabel(check.result ?? check.status);
  if (label) return label;
  if (check.ok === true) return "Complete";
  if (check.ok === false) return "Failed";
  return "Pending";
}

function checkLabel(check: Check) {
  return check.name || check.id || check.type || "Check";
}

function checkDetail(check: Check) {
  const detail = check.detail ?? check.note;
  return typeof detail === "string" && detail.trim() ? detail.trim() : null;
}

function incompleteChecks(checks?: Check[]) {
  return (checks ?? []).filter((c) => c.ok !== true);
}

function buildCheckSummary(check: Check) {
  const label = checkLabel(check);
  const status = friendlyCheckResult(check);
  const detail = checkDetail(check);
  const parts = [status];
  if (detail) parts.push(detail);
  return `${label}${parts.length ? ` — ${parts.join(" • ")}` : ""}`;
}

function buildItemCopyText(item: Item, week?: Week) {
  const { title: itemHeading, meta: itemMeta } = itemTitle(item);
  const { title: weekHeading, meta: weekMeta } = weekTitle(week);
  const weekPart = weekHeading ? `${weekHeading}${weekMeta ? ` (${weekMeta})` : ""}` : null;
  const itemPart = `${itemHeading}${itemMeta ? ` (${itemMeta})` : ""}`;

  const lines: string[] = [weekPart ? `${weekPart} — ${itemPart}` : itemPart];
  const checks = item.checks ?? [];
  const hasChecks = checks.length > 0;
  const status = itemStatus(item);
  lines.push(`Status: ${statusText(status, hasChecks)}`);

  const blockers = incompleteChecks(checks);
  if (hasChecks && blockers.length > 0) {
    lines.push("Blocked by:");
    blockers.forEach((chk) => {
      lines.push(`- ${buildCheckSummary(chk)}`);
    });
  } else if (!hasChecks) {
    lines.push("Blocked by: No checks configured yet.");
  } else {
    lines.push("Blocked by: None");
  }

  return lines.join("\n");
}

type IncompleteEntry = {
  key: string;
  week: Week;
  item: Item;
  summary: string;
  statusLabel: string;
  weekLabel: string;
  itemLabel: string;
  itemMeta?: string | null;
  blockers: string[];
};

function collectIncompleteEntries(weeks: Week[]): IncompleteEntry[] {
  const entries: IncompleteEntry[] = [];
  for (const week of weeks) {
    const { title: wTitle, meta: wMeta } = weekTitle(week);
    for (const item of week.items ?? []) {
      const status = itemStatus(item);
      const checks = item.checks ?? [];
      const hasChecks = checks.length > 0;
      if (status === true) continue;
      const { title: itemHeading, meta: itemMeta } = itemTitle(item);
      const blockers = hasChecks
        ? incompleteChecks(checks).map((chk) => buildCheckSummary(chk))
        : ["No checks configured yet."];
      entries.push({
        key: `${week.id ?? wTitle ?? "week"}::${item.id ?? itemHeading}`,
        week,
        item,
        summary: buildItemCopyText(item, week),
        statusLabel: statusText(status, hasChecks),
        weekLabel: wMeta ? `${wTitle} (${wMeta})` : wTitle,
        itemLabel: itemHeading,
        itemMeta,
        blockers,
      });
    }
  }
  return entries;
}

function buildOverallCopyText(entries: IncompleteEntry[]) {
  if (entries.length === 0) return "All roadmap items are complete!";
  const lines: string[] = [`Incomplete roadmap items (${entries.length}):`];
  entries.forEach((entry, index) => {
    const count = index + 1;
    const meta = entry.itemMeta ? ` (${entry.itemMeta})` : "";
    const weekPrefix = entry.weekLabel ? `${entry.weekLabel} — ` : "";
    lines.push(`${count}. ${weekPrefix}${entry.itemLabel}${meta}`);
    lines.push(`   Status: ${entry.statusLabel}`);
    entry.blockers.forEach((blocker) => {
      lines.push(`   - ${blocker}`);
    });
  });
  return lines.join("\n");
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

function ItemCard({ item, week }: { item: Item; week: Week }) {
  const sum = summarizeChecks(item.checks);
  const summary = formatStatusSummary(sum);
  const ok = itemStatus(item);
  const tone = statusTone(ok, sum.total > 0);
  const title = item.name || item.id || "Untitled item";
  const subtitle = item.id && item.id !== item.name ? item.id : null;
  const hasIncomplete = ok !== true;
  const copyText = useMemo(() => buildItemCopyText(item, week), [item, week]);

  return (
    <div className={`item-card item-${tone}`}>
      <div className="item-header">
        <div className="item-heading">
          <div className="item-title">{title}</div>
          {subtitle ? <div className="item-meta">{subtitle}</div> : null}
        </div>
        <div className="item-actions">
          <StatusBadge ok={ok} total={sum.total} summary={summary} />
          {hasIncomplete ? (
            <CopyButton
              label="Copy incomplete details"
              text={copyText}
              disabled={!hasIncomplete}
              size="small"
            />
          ) : null}
        </div>
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
            <ItemCard key={`${it.id ?? it.name ?? i}`} item={it} week={week} />
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
  const incompleteEntries = useMemo(() => collectIncompleteEntries(data?.weeks ?? []), [data]);

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

          <IncompleteSummary entries={incompleteEntries} />

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

function CopyButton({
  label,
  text,
  disabled,
  size = "default",
}: {
  label: string;
  text: string;
  disabled?: boolean;
  size?: "default" | "small";
}) {
  const [state, setState] = useState<CopyState>(CopyState.Idle);

  useEffect(() => {
    if (state === CopyState.Idle) return undefined;
    const timer = setTimeout(() => setState(CopyState.Idle), 1800);
    return () => clearTimeout(timer);
  }, [state]);

  const attemptCopy = useCallback(async () => {
    if (disabled) return;
    try {
      const success = await copyTextToClipboard(text);
      setState(success ? CopyState.Copied : CopyState.Error);
    } catch {
      setState(CopyState.Error);
    }
  }, [disabled, text]);

  const classNames = ["copy-button", `copy-${size}`];
  if (state === CopyState.Copied) classNames.push("copy-success");
  if (state === CopyState.Error) classNames.push("copy-error");

  const buttonLabel = state === CopyState.Copied ? "Copied!" : state === CopyState.Error ? "Copy failed" : label;

  return (
    <button
      type="button"
      className={classNames.join(" ")}
      onClick={attemptCopy}
      disabled={disabled}
      aria-live="polite"
    >
      <span className="copy-button-icon" aria-hidden="true">
        {state === CopyState.Copied ? "✅" : "📋"}
      </span>
      <span>{buttonLabel}</span>
    </button>
  );
}

function copyTextToClipboard(text: string) {
  if (typeof navigator === "undefined") return Promise.resolve(false);
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard
      .writeText(text)
      .then(() => true)
      .catch(() => false);
  }

  if (typeof document === "undefined") return Promise.resolve(false);

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return Promise.resolve(ok);
  } catch {
    return Promise.resolve(false);
  }
}

function IncompleteSummary({ entries }: { entries: IncompleteEntry[] }) {
  const count = entries.length;
  const copyText = useMemo(() => buildOverallCopyText(entries), [entries]);

  return (
    <div className="incomplete-card">
      <div className="status-row">
        <div className="section-title">Incomplete tasks</div>
        <div className="incomplete-actions">
          <CopyButton label={`Copy all (${count})`} text={copyText} disabled={count === 0} />
        </div>
      </div>
      {count === 0 ? (
        <div className="empty-subtasks">All roadmap items are complete. 🎉</div>
      ) : (
        <ul className="incomplete-list">
          {entries.map((entry) => (
            <li key={entry.key} className="incomplete-item">
              <div className="incomplete-item-header">
                <div className="incomplete-item-title">{entry.itemLabel}</div>
                {entry.itemMeta ? <div className="incomplete-item-meta">{entry.itemMeta}</div> : null}
              </div>
              {entry.weekLabel ? <div className="incomplete-item-week">{entry.weekLabel}</div> : null}
              <div className="incomplete-item-status">Status: {entry.statusLabel}</div>
              <ul className="incomplete-blockers">
                {entry.blockers.map((blocker, idx) => (
                  <li key={`${entry.key}-blocker-${idx}`}>{blocker}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


