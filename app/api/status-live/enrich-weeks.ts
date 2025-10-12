const PASS_STATUSES = new Set([
  "pass",
  "passed",
  "ok",
  "success",
  "succeeded",
  "complete",
  "completed",
  "done",
  "✅",
]);

const FAIL_STATUSES = new Set(["fail", "failed", "error", "missing", "❌"]);

type StatusValue = "pass" | "fail" | "skip" | string | undefined;

export type EnrichMode = "live" | "artifact";

export type RunCheckResult = { status: "pass" | "fail" | "skip"; note?: string };

export type RunCheckFn = (
  owner: string,
  repo: string,
  branch: string,
  token: string | undefined,
  rc: any,
  check: any,
) => Promise<RunCheckResult>;

export type EnrichWeeksContext = {
  owner: string;
  repo: string;
  branch: string;
  token?: string;
  rc: any;
  mode: EnrichMode;
  runCheck: RunCheckFn;
};

function normalizeStatusValue(val: unknown) {
  return typeof val === "string" ? val.trim().toLowerCase() : "";
}

function inferOk(status: StatusValue, fallback?: unknown): boolean | undefined {
  if (typeof fallback === "boolean") return fallback;
  const norm = normalizeStatusValue(status);
  if (PASS_STATUSES.has(norm)) return true;
  if (FAIL_STATUSES.has(norm)) return false;
  if (norm === "skip" || norm === "skipped" || norm === "pending") return undefined;
  return undefined;
}

function textOrNull(val: unknown) {
  if (typeof val !== "string") return undefined;
  const trimmed = val.trim();
  return trimmed ? trimmed : undefined;
}

function mergeDetail(detail: unknown, note: unknown) {
  const base = textOrNull(detail);
  const extra = textOrNull(note);
  if (base && extra && base !== extra) return `${base} – ${extra}`;
  return extra ?? base;
}

function cloneCheck(check: any) {
  if (check && typeof check === "object" && !Array.isArray(check)) {
    return { ...check };
  }
  if (typeof check === "string") {
    return { type: check };
  }
  return { type: "unknown" };
}

async function enrichWeeks(weeks: any, ctx: EnrichWeeksContext) {
  const sourceWeeks = Array.isArray(weeks) ? weeks : [];
  const out: any[] = [];

  for (const week of sourceWeeks) {
    if (!week || typeof week !== "object") {
      out.push(week);
      continue;
    }

    const sourceItems = Array.isArray((week as any).items) ? (week as any).items : [];
    const itemsOut: any[] = [];

    for (const item of sourceItems) {
      if (!item || typeof item !== "object") {
        itemsOut.push(item);
        continue;
      }

      const itemObj: any = { ...item };
      const sourceChecksList = Array.isArray(item.checks)
        ? item.checks
        : Array.isArray((item as any).results)
        ? (item as any).results
        : [];
      const sourceChecks = sourceChecksList as any[];
      const checksOut: any[] = [];

      if (ctx.mode === "live") {
        for (const check of sourceChecks) {
          const base = cloneCheck(check);
          // eslint-disable-next-line no-await-in-loop
          const result = await ctx.runCheck(ctx.owner, ctx.repo, ctx.branch, ctx.token, ctx.rc, check);
          base.status = result.status;
          base.result = result.status;
          if (result.note !== undefined) base.note = result.note;
          const detail = mergeDetail(base.detail, result.note);
          if (detail !== undefined) base.detail = detail;
          base.ok = inferOk(result.status);
          checksOut.push(base);
        }
      } else {
        for (const check of sourceChecks) {
          const base = cloneCheck(check);
          const status = base.result ?? base.status ?? (typeof base.ok === "boolean" ? (base.ok ? "pass" : "fail") : undefined);
          if (status !== undefined) {
            base.status = status;
            base.result = status;
          } else {
            delete base.status;
            delete base.result;
          }
          const ok = inferOk(status, base.ok);
          if (ok !== undefined) base.ok = ok;
          const detail = mergeDetail(base.detail, base.note);
          if (detail !== undefined) base.detail = detail;
          checksOut.push(base);
        }
      }

      itemObj.checks = checksOut;
      itemObj.results = checksOut;

      const computedDone = checksOut.length > 0 ? checksOut.every((c) => c.ok === true) : undefined;
      const explicitDone = typeof item.done === "boolean" ? item.done : undefined;

      if (computedDone !== undefined) itemObj.done = computedDone;
      else if (explicitDone !== undefined) itemObj.done = explicitDone;
      else delete itemObj.done;

      itemsOut.push(itemObj);
    }

    out.push({ ...week, items: itemsOut });
  }

  return out;
}

export { enrichWeeks, inferOk };
