"use client";

import { Suspense, type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Check = {
  id?: string;
  name?: string;
  type: string;
  ok?: boolean;
  detail?: string;
  note?: string;
  status?: string;
  result?: string;
};

type Item = {
  id?: string;
  name?: string;
  checks?: Check[];
  done?: boolean;
  note?: string;
  manual?: boolean;
  manualKey?: string;
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

type RepoRef = {
  owner: string;
  repo: string;
  label?: string;
};

type ManualItem = {
  key: string;
  name: string;
  note?: string;
  done?: boolean;
};

type ManualWeekState = {
  added: ManualItem[];
  removed: string[];
};

type ManualState = Record<string, ManualWeekState>;

type DecoratedItem = Item & { manualKey?: string; manual?: boolean };
type DecoratedWeek = Week & { manualKey: string; manualState: ManualWeekState; items?: DecoratedItem[] };

const DEFAULT_REPOS: RepoRef[] = [{ owner: "SSkylar1", repo: "Roadmap-Kit-Starter" }];
const REPO_STORAGE_KEY = "roadmap-dashboard.repos";
const MANUAL_STORAGE_PREFIX = "roadmap-dashboard.manual.";

function repoKey(owner: string, repo: string) {
  return `${owner.trim().toLowerCase()}/${repo.trim().toLowerCase()}`;
}

function normalizeRepoRef(ref: Partial<RepoRef> | RepoRef): RepoRef {
  const owner = typeof ref?.owner === "string" ? ref.owner.trim() : "";
  const repo = typeof ref?.repo === "string" ? ref.repo.trim() : "";
  const label = typeof ref?.label === "string" ? ref.label.trim() : undefined;
  return { owner, repo, label };
}

function sanitizeManualState(value: unknown): ManualState {
  const safe: ManualState = {};
  if (!value || typeof value !== "object") return safe;

  for (const [weekKey, rawWeek] of Object.entries(value as Record<string, unknown>)) {
    if (typeof weekKey !== "string") continue;
    const weekValue = rawWeek as Partial<ManualWeekState>;
    const addedRaw = Array.isArray(weekValue?.added) ? weekValue.added : [];
    const removedRaw = Array.isArray(weekValue?.removed) ? weekValue.removed : [];
    const added: ManualItem[] = addedRaw
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const item = entry as ManualItem;
        const key = typeof item.key === "string" ? item.key : null;
        const name = typeof item.name === "string" ? item.name : null;
        if (!key || !name) return null;
        const note = typeof item.note === "string" ? item.note : undefined;
        const done = typeof item.done === "boolean" ? item.done : undefined;
        return { key, name, note, done };
      })
      .filter((entry): entry is ManualItem => Boolean(entry));
    const removed = removedRaw.filter((entry): entry is string => typeof entry === "string");

    if (added.length > 0 || removed.length > 0) {
      safe[weekKey] = { added, removed };
    }
  }

  return safe;
}

function getWeekKey(week: Week, index: number) {
  return week.id || week.title || `week-${index + 1}`;
}

function getItemKey(item: Item, index: number) {
  return item.id || item.name || `item-${index + 1}`;
}

function useStatus(owner: string, repo: string) {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!owner || !repo) {
      setData(null);
      setErr(null);
      setLoading(false);
      return;
    }

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
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [owner, repo]);

  return { data, err, loading };
}

function useStoredRepos() {
  const [repos, setRepos] = useState<RepoRef[]>(DEFAULT_REPOS);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(REPO_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const sanitized = parsed
            .map((value) => normalizeRepoRef(value as Partial<RepoRef>))
            .filter((value) => value.owner && value.repo);
          if (sanitized.length > 0) {
            setRepos(sanitized);
          }
        }
      }
    } catch {
      // ignore corrupt storage
    } finally {
      setInitialized(true);
    }
  }, []);

  const setAndStore = useCallback((updater: (prev: RepoRef[]) => RepoRef[]) => {
    setRepos((prev) => {
      const next = updater(prev);
      if (typeof window !== "undefined") {
        if (next.length === 0) {
          window.localStorage.removeItem(REPO_STORAGE_KEY);
        } else {
          window.localStorage.setItem(REPO_STORAGE_KEY, JSON.stringify(next));
        }
      }
      return next;
    });
  }, []);

  const addRepo = useCallback(
    (repo: RepoRef): RepoRef | null => {
      const normalized = normalizeRepoRef(repo);
      if (!normalized.owner || !normalized.repo) return null;
      const key = repoKey(normalized.owner, normalized.repo);

      setAndStore((prev) => {
        const idx = prev.findIndex((entry) => repoKey(entry.owner, entry.repo) === key);
        if (idx >= 0) {
          const next = [...prev];
          const existing = next[idx];
          next.splice(idx, 1);
          next.unshift({ ...existing, ...normalized });
          return next;
        }
        return [normalized, ...prev];
      });

      return normalized;
    },
    [setAndStore]
  );

  const removeRepo = useCallback(
    (repo: RepoRef) => {
      const normalized = normalizeRepoRef(repo);
      if (!normalized.owner || !normalized.repo) return;
      const key = repoKey(normalized.owner, normalized.repo);
      setAndStore((prev) => prev.filter((entry) => repoKey(entry.owner, entry.repo) !== key));
    },
    [setAndStore]
  );

  return { repos, initialized, addRepo, removeRepo };
}

function useManualRoadmap(owner?: string, repo?: string) {
  const storageKey = owner && repo ? `${MANUAL_STORAGE_PREFIX}${repoKey(owner, repo)}` : null;
  const [state, setState] = useState<ManualState>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!storageKey) {
      setState({});
      setReady(false);
      return;
    }
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        setState(sanitizeManualState(parsed));
      } else {
        setState({});
      }
    } catch {
      setState({});
    }
    setReady(true);
  }, [storageKey]);

  const setAndStore = useCallback(
    (updater: (prev: ManualState) => ManualState) => {
      if (!storageKey) return;
      setState((prev) => {
        const next = updater(prev);
        if (typeof window !== "undefined") {
          if (Object.keys(next).length === 0) {
            window.localStorage.removeItem(storageKey);
          } else {
            window.localStorage.setItem(storageKey, JSON.stringify(next));
          }
        }
        return next;
      });
    },
    [storageKey]
  );

  const addManualItem = useCallback(
    (weekKey: string, payload: { name: string; note?: string }) => {
      if (!storageKey) return;
      const trimmedName = payload.name.trim();
      if (!trimmedName) return;
      const trimmedNote = payload.note?.trim() || undefined;

      const manualItem: ManualItem = {
        key: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: trimmedName,
        note: trimmedNote,
      };

      setAndStore((prev) => {
        const current = prev[weekKey] ?? { added: [], removed: [] };
        const nextWeek: ManualWeekState = {
          added: [...current.added, manualItem],
          removed: current.removed,
        };
        return { ...prev, [weekKey]: nextWeek };
      });
    },
    [setAndStore, storageKey]
  );

  const removeManualItem = useCallback(
    (weekKey: string, manualKey: string) => {
      if (!storageKey) return;
      setAndStore((prev) => {
        const current = prev[weekKey];
        if (!current) return prev;
        const nextAdded = current.added.filter((item) => item.key !== manualKey);
        const nextWeek: ManualWeekState = { added: nextAdded, removed: current.removed };
        const next = { ...prev };
        if (nextWeek.added.length === 0 && nextWeek.removed.length === 0) {
          delete next[weekKey];
        } else {
          next[weekKey] = nextWeek;
        }
        return next;
      });
    },
    [setAndStore, storageKey]
  );

  const hideExistingItem = useCallback(
    (weekKey: string, itemKey: string) => {
      if (!storageKey || !itemKey) return;
      setAndStore((prev) => {
        const current = prev[weekKey] ?? { added: [], removed: [] };
        if (current.removed.includes(itemKey)) return prev;
        const nextWeek: ManualWeekState = {
          added: current.added,
          removed: [...current.removed, itemKey],
        };
        return { ...prev, [weekKey]: nextWeek };
      });
    },
    [setAndStore, storageKey]
  );

  const resetWeek = useCallback(
    (weekKey: string) => {
      if (!storageKey) return;
      setAndStore((prev) => {
        if (!prev[weekKey]) return prev;
        const next = { ...prev };
        delete next[weekKey];
        return next;
      });
    },
    [setAndStore, storageKey]
  );

  const resetAll = useCallback(() => {
    if (!storageKey) return;
    setState({});
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  return { state, ready, addManualItem, removeManualItem, hideExistingItem, resetWeek, resetAll };
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

function ItemCard({
  item,
  onDelete,
  allowDelete,
}: {
  item: DecoratedItem;
  onDelete?: () => void;
  allowDelete: boolean;
}) {
  const sum = summarizeChecks(item.checks);
  const summary = formatStatusSummary(sum);
  const ok = itemStatus(item);
  const tone = statusTone(ok, sum.total > 0);
  const title = item.name || item.id || "Untitled item";
  const subtitle = item.id && item.id !== item.name ? item.id : null;
  const note = item.note?.trim();
  const isManual = item.manual === true;
  const canDelete = allowDelete && Boolean(onDelete) && Boolean(item.manualKey);

  return (
    <div className={`item-card item-${tone}`}>
      <div className="item-header">
        <div className="item-heading">
          <div className="item-title-row">
            <div className="item-title">{title}</div>
            {isManual ? <span className="manual-pill">Manual</span> : null}
          </div>
          {subtitle ? <div className="item-meta">{subtitle}</div> : null}
        </div>
        <div className="item-actions">
          <StatusBadge ok={ok} total={sum.total} summary={summary} />
          {canDelete ? (
            <button type="button" className="ghost-button compact" onClick={onDelete}>
              Remove
            </button>
          ) : null}
        </div>
      </div>

      {note ? <div className="item-note">{note}</div> : null}

      {sum.total > 0 ? (
        <ul className="subtask-list">
          {(item.checks ?? []).map((c, i) => {
            const key = c.id || c.name || c.type || `check-${i}`;
            return <CheckRow key={key} c={c} />;
          })}
        </ul>
      ) : (
        <div className="empty-subtasks">
          {isManual ? "No linked checks yet for this manual item." : "No sub tasks yet."}
        </div>
      )}
    </div>
  );
}

function ManualItemForm({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (payload: { name: string; note?: string }) => void;
}) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedNote = note.trim();
    if (!trimmedName) {
      setError("Add a title before saving the manual item.");
      return;
    }
    onAdd({ name: trimmedName, note: trimmedNote || undefined });
    setName("");
    setNote("");
    setError(null);
  };

  return (
    <form className="manual-item-form" onSubmit={handleSubmit}>
      <label className="manual-label">
        Item title
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Ship dashboard polish"
          disabled={disabled}
        />
      </label>
      <label className="manual-label">
        Notes <span className="manual-optional">(optional)</span>
        <textarea
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Any extra context you want to track."
          disabled={disabled}
        />
      </label>
      {error ? <div className="manual-error">{error}</div> : null}
      <div className="manual-actions">
        <button type="submit" disabled={disabled || !name.trim()}>
          Add manual item
        </button>
      </div>
    </form>
  );
}

function WeekCard({
  week,
  manualReady,
  onAddManualItem,
  onDeleteItem,
  onResetManual,
}: {
  week: DecoratedWeek;
  manualReady: boolean;
  onAddManualItem: (weekKey: string, payload: { name: string; note?: string }) => void;
  onDeleteItem: (weekKey: string, item: DecoratedItem) => void;
  onResetManual: (weekKey: string) => void;
}) {
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
  const manualState = week.manualState ?? { added: [], removed: [] };
  const manualCounts = {
    added: manualState.added.length,
    removed: manualState.removed.length,
  };
  const manualSummaryParts: string[] = [];
  if (manualCounts.added > 0) manualSummaryParts.push(`${manualCounts.added} added`);
  if (manualCounts.removed > 0) manualSummaryParts.push(`${manualCounts.removed} hidden`);
  const manualSummary = manualSummaryParts.join(" · ");
  const showManualSummary = manualReady && manualSummaryParts.length > 0;

  return (
    <section className={`week-card week-${tone}`}>
      <div className="week-header">
        <div className="week-heading">
          <div className="week-title">{title}</div>
          {subtitle ? <div className="week-meta">{subtitle}</div> : null}
        </div>
        <StatusBadge ok={ok} total={rollup.total} summary={summary} />
      </div>

      {showManualSummary ? (
        <div className="manual-summary">
          <div className="manual-summary-text">{manualSummary}</div>
          <button type="button" className="ghost-button compact" onClick={() => onResetManual(week.manualKey)}>
            Reset week
          </button>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="week-items">
          {items.map((it, i) => (
            <ItemCard
              key={`${it.manualKey ?? it.id ?? it.name ?? i}`}
              item={it}
              allowDelete={manualReady}
              onDelete={it.manualKey ? () => onDeleteItem(week.manualKey, it) : undefined}
            />
          ))}
        </div>
      ) : (
        <div className="empty-subtasks">No tasks tracked for this week yet.</div>
      )}

      <details className="manual-details">
        <summary>Add manual item</summary>
        <ManualItemForm disabled={!manualReady} onAdd={(payload) => onAddManualItem(week.manualKey, payload)} />
        {!manualReady ? <div className="manual-hint">Manual items are loading…</div> : null}
      </details>
    </section>
  );
}

function ProjectSidebar({
  repos,
  activeKey,
  initializing,
  onSelect,
  onRemove,
  onAdd,
}: {
  repos: RepoRef[];
  activeKey: string | null;
  initializing: boolean;
  onSelect: (repo: RepoRef) => void;
  onRemove: (repo: RepoRef) => void;
  onAdd: (repo: RepoRef) => RepoRef | null;
}) {
  const [ownerInput, setOwnerInput] = useState("");
  const [repoInput, setRepoInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let owner = ownerInput.trim();
    let repo = repoInput.trim();

    if (!repo && owner.includes("/")) {
      const [maybeOwner, maybeRepo] = owner.split("/");
      if (maybeOwner && maybeRepo) {
        owner = maybeOwner.trim();
        repo = maybeRepo.trim();
      }
    }

    if (!owner || !repo) {
      setError("Both owner and repo are required.");
      return;
    }

    const added = onAdd({ owner, repo });
    if (!added) {
      setError("Both owner and repo are required.");
      return;
    }

    onSelect(added);
    setOwnerInput("");
    setRepoInput("");
    setError(null);
  };

  return (
    <aside className="project-panel">
      <div className="project-header">
        <h2>Projects</h2>
        <a className="project-wizard" href="/new">
          Open wizard ↗
        </a>
      </div>
      {initializing ? <div className="project-hint">Loading saved projects…</div> : null}
      {repos.length === 0 ? (
        <div className="project-empty">
          No projects yet. Add one below or run the onboarding wizard to connect a repository.
        </div>
      ) : (
        <ul className="project-list">
          {repos.map((repo) => {
            const key = repoKey(repo.owner, repo.repo);
            const slug = `${repo.owner}/${repo.repo}`;
            const active = key === activeKey;
            return (
              <li key={key} className="project-item">
                <button
                  type="button"
                  className={`project-button${active ? " active" : ""}`}
                  onClick={() => onSelect(repo)}
                >
                  <span className="project-slug">{slug}</span>
                  {active ? <span className="project-active">Viewing</span> : null}
                </button>
                <button
                  type="button"
                  className="icon-button danger"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(repo);
                  }}
                  aria-label={`Remove ${slug}`}
                  title="Remove project"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <form className="project-form" onSubmit={handleSubmit}>
        <div className="project-form-row">
          <div>
            <label>Owner or owner/repo</label>
            <input
              value={ownerInput}
              onChange={(e) => {
                setOwnerInput(e.target.value);
                if (error) setError(null);
              }}
              placeholder="acme-co"
              autoComplete="off"
            />
          </div>
          <div>
            <label>Repository</label>
            <input
              value={repoInput}
              onChange={(e) => {
                setRepoInput(e.target.value);
                if (error) setError(null);
              }}
              placeholder="dashboard"
              autoComplete="off"
            />
          </div>
        </div>
        {error ? <div className="project-error">{error}</div> : null}
        <button type="submit">Add project</button>
      </form>
    </aside>
  );
}

function DashboardPage() {
  const sp = useSearchParams();
  const searchString = sp.toString();
  const searchOwner = sp.get("owner");
  const searchRepo = sp.get("repo");
  const searchKey = searchOwner && searchRepo ? repoKey(searchOwner, searchRepo) : null;

  const router = useRouter();
  const pathname = usePathname();

  const { repos, initialized, addRepo, removeRepo } = useStoredRepos();
  const [activeKey, setActiveKey] = useState<string | null>(null);

  useEffect(() => {
    if (!initialized) return;
    if (searchKey && searchOwner && searchRepo) {
      setActiveKey(searchKey);
      const exists = repos.some((repo) => repoKey(repo.owner, repo.repo) === searchKey);
      if (!exists) {
        addRepo({ owner: searchOwner, repo: searchRepo });
      }
      return;
    }

    setActiveKey((prev) => {
      if (prev && repos.some((repo) => repoKey(repo.owner, repo.repo) === prev)) {
        return prev;
      }
      return repos.length > 0 ? repoKey(repos[0].owner, repos[0].repo) : null;
    });
  }, [initialized, searchKey, repos, addRepo, searchOwner, searchRepo]);

  const activeRepo = useMemo(() => {
    if (!activeKey) return null;
    return repos.find((repo) => repoKey(repo.owner, repo.repo) === activeKey) ?? null;
  }, [repos, activeKey]);

  useEffect(() => {
    if (!initialized) return;
    if (!activeRepo) return;
    if (
      searchOwner &&
      searchRepo &&
      searchOwner.toLowerCase() === activeRepo.owner.toLowerCase() &&
      searchRepo.toLowerCase() === activeRepo.repo.toLowerCase()
    ) {
      return;
    }
    const params = new URLSearchParams(searchString);
    params.set("owner", activeRepo.owner);
    params.set("repo", activeRepo.repo);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [activeRepo, initialized, pathname, router, searchOwner, searchRepo, searchString]);

  const { data, err, loading } = useStatus(activeRepo?.owner ?? "", activeRepo?.repo ?? "");
  const {
    state: manualState,
    ready: manualReady,
    addManualItem,
    removeManualItem,
    hideExistingItem,
    resetWeek,
    resetAll,
  } = useManualRoadmap(activeRepo?.owner, activeRepo?.repo);

  const decoratedWeeks: DecoratedWeek[] = useMemo(() => {
    if (!data) return [];
    return (data.weeks ?? []).map((week, weekIndex) => {
      const manualKey = getWeekKey(week, weekIndex);
      const manualWeek = manualState[manualKey] ?? { added: [], removed: [] };
      const baseItems: DecoratedItem[] = (week.items ?? []).map((item, itemIndex) => ({
        ...item,
        manual: false,
        manualKey: getItemKey(item, itemIndex),
      }));
      const filteredBase = baseItems.filter((item) => !manualWeek.removed.includes(item.manualKey ?? ""));
      const manualItems: DecoratedItem[] = manualWeek.added.map((manualItem) => ({
        id: manualItem.key,
        name: manualItem.name,
        note: manualItem.note,
        done: manualItem.done,
        checks: [],
        manual: true,
        manualKey: manualItem.key,
      }));
      return {
        ...week,
        manualKey,
        manualState: manualWeek,
        items: [...filteredBase, ...manualItems],
      };
    });
  }, [data, manualState]);

  const manualTotals = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const week of Object.values(manualState)) {
      added += week.added.length;
      removed += week.removed.length;
    }
    return { added, removed };
  }, [manualState]);

  const hasManualChanges = manualReady && (manualTotals.added > 0 || manualTotals.removed > 0);

  const handleSelectRepo = useCallback((repo: RepoRef) => {
    setActiveKey(repoKey(repo.owner, repo.repo));
  }, []);

  const handleAddRepo = useCallback(
    (repo: RepoRef) => {
      const added = addRepo(repo);
      if (added) {
        setActiveKey(repoKey(added.owner, added.repo));
      }
      return added;
    },
    [addRepo]
  );

  const handleRemoveRepo = useCallback(
    (repo: RepoRef) => {
      removeRepo(repo);
    },
    [removeRepo]
  );

  const handleAddManualItem = useCallback(
    (weekKey: string, payload: { name: string; note?: string }) => {
      addManualItem(weekKey, payload);
    },
    [addManualItem]
  );

  const handleDeleteItem = useCallback(
    (weekKey: string, item: DecoratedItem) => {
      if (!item.manualKey) return;
      if (item.manual) {
        removeManualItem(weekKey, item.manualKey);
      } else {
        hideExistingItem(weekKey, item.manualKey);
      }
    },
    [hideExistingItem, removeManualItem]
  );

  return (
    <main className="dashboard-shell">
      <ProjectSidebar
        repos={repos}
        activeKey={activeKey}
        initializing={!initialized}
        onSelect={handleSelectRepo}
        onRemove={handleRemoveRepo}
        onAdd={handleAddRepo}
      />
      <section className="dashboard">
        {activeRepo ? (
          <>
            <div className="repo-line">
              <span className="repo-label">Repo:</span>
              <code>
                {activeRepo.owner}/{activeRepo.repo}
              </code>
              <a href={`/api/status/${activeRepo.owner}/${activeRepo.repo}`} target="_blank" rel="noreferrer">
                View status JSON ↗
              </a>
            </div>

            {hasManualChanges ? (
              <div className="card manual-project-banner">
                <div>
                  <div className="banner-title">Manual adjustments in this project</div>
                  <div className="banner-subtitle">
                    {manualTotals.added} added · {manualTotals.removed} hidden
                  </div>
                </div>
                <button type="button" className="ghost-button danger" onClick={resetAll} disabled={!manualReady}>
                  Reset all manual items
                </button>
              </div>
            ) : null}

            {loading ? <div className="card muted">Loading status…</div> : null}

            {err && !loading ? (
              <div className="card error">
                <div className="card-title">Failed to load status</div>
                <div className="card-subtitle">{err}</div>
                <div className="card-subtitle">
                  Try running the onboarding wizard at <code>/new</code>.
                </div>
              </div>
            ) : null}

            {decoratedWeeks.length > 0 ? <WeekProgress weeks={decoratedWeeks} /> : null}

            {data && decoratedWeeks.length > 0 ? (
              <div className="week-grid">
                {decoratedWeeks.map((week, i) => (
                  <WeekCard
                    key={`${week.manualKey ?? week.id ?? i}`}
                    week={week}
                    manualReady={manualReady}
                    onAddManualItem={handleAddManualItem}
                    onDeleteItem={handleDeleteItem}
                    onResetManual={resetWeek}
                  />
                ))}
              </div>
            ) : null}

            {data ? (
              <div className="timestamp">
                Generated at: {data.generated_at ?? "unknown"} · env: {data.env ?? "unknown"}
              </div>
            ) : null}

            {!loading && !err && (!data || decoratedWeeks.length === 0) ? (
              <div className="card muted">
                No weeks found. Make sure your <code>.roadmaprc.json</code> or status API is populated.
              </div>
            ) : null}
          </>
        ) : (
          <div className="card muted">
            Add a project from the sidebar to load its roadmap and weekly progress.
          </div>
        )}
      </section>
    </main>
  );
}

function PageFallback() {
  return (
    <main className="dashboard-shell">
      <aside className="project-panel">
        <div className="project-header">
          <h2>Projects</h2>
        </div>
        <div className="project-hint">Loading saved projects…</div>
      </aside>
      <section className="dashboard">
        <div className="card muted">Loading dashboard…</div>
      </section>
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
