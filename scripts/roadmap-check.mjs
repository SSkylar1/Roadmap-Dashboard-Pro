#!/usr/bin/env node
// scripts/roadmap-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const defaultProjectRoot = path.resolve(path.dirname(__filename), '..');

function relativeToProject(p, projectRoot) {
  return path.relative(projectRoot, p) || '.';
}

function readRoadmap(file, projectRoot = defaultProjectRoot) {
  if (!fs.existsSync(file)) {
    const rel = relativeToProject(file, projectRoot);
    throw new Error(`Missing roadmap file at ${rel}`);
  }
  const text = fs.readFileSync(file, 'utf8');
  const doc = yaml.load(text);
  if (!doc || typeof doc !== 'object') throw new Error('Invalid roadmap YAML structure');
  return doc;
}

const KNOWN_CHECK_TYPES = new Set(['files_exist', 'http_ok', 'sql_exists']);

function computeHashSuffix(value, length = 6) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  const base36 = hash.toString(36);
  if (base36.length >= length) {
    return base36.slice(-length);
  }
  return base36.padStart(length, '0');
}

function slugify(value, fallback) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!normalized) {
    return fallback;
  }

  if (normalized.length <= 64) {
    return normalized;
  }

  const hash = computeHashSuffix(normalized);
  const maxBaseLength = Math.max(0, 64 - hash.length - 1);
  const trimmed = normalized.slice(0, maxBaseLength).replace(/-+$/g, '');
  const slug = [trimmed, hash].filter(Boolean).join('-');
  return slug || fallback;
}

function pickString(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
    }
    if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        if (typeof entry === 'string') {
          const trimmed = entry.trim();
          if (trimmed) return trimmed;
        }
      }
    }
  }
  return undefined;
}

function collectStrings(value) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectStrings(entry)).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[\n,]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (value && typeof value === 'object') {
    return collectStrings(Object.values(value));
  }
  return [];
}

function dedupeStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function coerceBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    if (value <= 0) return false;
    if (value >= 1) return true;
    return undefined;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (
      ['true', 'yes', 'y', 'done', 'complete', 'completed', 'finished', 'launched', 'live'].includes(
        normalized,
      )
    ) {
      return true;
    }
    if (['false', 'no', 'n', 'todo', 'pending', 'blocked', 'tbd', 'hold', 'paused', 'stalled'].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

function detectCheckType(record) {
  const rawType = pickString(record.type, record.kind, record.check);
  if (rawType) {
    const normalized = rawType.toLowerCase().replace(/[-\s]+/g, '_');
    if (KNOWN_CHECK_TYPES.has(normalized)) {
      return normalized;
    }
  }

  if (record.url || record.endpoint || record.href || record.link) {
    return 'http_ok';
  }
  if (record.query || record.sql || record.statement) {
    return 'sql_exists';
  }
  if (record.files || record.file || record.paths || record.path || record.globs || record.glob || record.patterns) {
    return 'files_exist';
  }
  return '';
}

function normalizeCheck(entry) {
  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) {
      return { type: 'http_ok', url: trimmed };
    }
    return { type: 'files_exist', files: [trimmed] };
  }

  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const record = entry;
  const type = detectCheckType(record);
  if (!type) return null;

  if (type === 'files_exist') {
    const files = dedupeStrings([
      ...collectStrings(record.files),
      ...collectStrings(record.file),
      ...collectStrings(record.paths),
      ...collectStrings(record.path),
    ]);
    const globs = dedupeStrings([
      ...collectStrings(record.globs),
      ...collectStrings(record.glob),
      ...collectStrings(record.patterns),
    ]);
    const detail = pickString(record.detail, record.note, record.description);

    if (detail) {
      for (const token of collectStrings(detail)) {
        if (!files.includes(token) && !globs.includes(token) && /[./]/.test(token)) {
          files.push(token);
        }
      }
    }

    if (!files.length && !globs.length && !detail) {
      return null;
    }

    const payload = { type: 'files_exist' };
    if (files.length) payload.files = files;
    if (globs.length) payload.globs = globs;
    if (detail) payload.detail = detail;
    return payload;
  }

  if (type === 'http_ok') {
    const url = pickString(record.url, record.endpoint, record.href, record.link, record.target);
    if (!url) return null;
    const mustMatch = dedupeStrings([
      ...collectStrings(record.must_match),
      ...collectStrings(record.mustMatch),
      ...collectStrings(record.contains),
      ...collectStrings(record.expect),
      ...collectStrings(record.matches),
    ]);
    const detail = pickString(record.detail, record.note, record.description);
    const payload = { type: 'http_ok', url };
    if (mustMatch.length) payload.must_match = mustMatch;
    if (detail) payload.detail = detail;
    return payload;
  }

  if (type === 'sql_exists') {
    const query = pickString(record.query, record.sql, record.statement);
    if (!query) return null;
    const detail = pickString(record.detail, record.note, record.description);
    const payload = { type: 'sql_exists', query };
    if (detail) payload.detail = detail;
    return payload;
  }

  return null;
}

function normalizeChecks(record) {
  const provided = record.checks ?? record.verifications ?? record.validation;
  const rawChecks = [];

  if (Array.isArray(provided)) {
    rawChecks.push(...provided);
  } else if (provided) {
    rawChecks.push(provided);
  }

  if (rawChecks.length === 0) {
    const files = dedupeStrings([
      ...collectStrings(record.files),
      ...collectStrings(record.file),
      ...collectStrings(record.paths),
      ...collectStrings(record.path),
    ]);
    const globs = dedupeStrings([
      ...collectStrings(record.globs),
      ...collectStrings(record.glob),
      ...collectStrings(record.patterns),
    ]);
    const url = pickString(record.url, record.endpoint, record.href, record.link, record.target);
    const detail = pickString(record.detail, record.note, record.description);

    if (files.length || globs.length) {
      rawChecks.push({ type: 'files_exist', files, globs, detail });
    } else if (url) {
      rawChecks.push({ type: 'http_ok', url, detail });
    }
  }

  return rawChecks
    .map((entry) => normalizeCheck(entry))
    .filter((entry) => Boolean(entry));
}

function canonicalizeItem(entry, context) {
  if (entry === null || entry === undefined) return null;

  if (typeof entry === 'string') {
    const name = entry.trim();
    if (!name) return null;
    const id = slugify(
      `${context.weekId}-${name}`,
      `item-${context.weekIndex + 1}-${context.itemIndex + 1}`,
    );
    return { id, name, checks: [], manual: true };
  }

  if (typeof entry !== 'object') {
    return null;
  }

  const record = entry;
  const nameCandidate =
    pickString(record.name, record.title, record.task, record.summary, record.goal, record.description) ??
    pickString(record.id);
  const name = nameCandidate?.trim();
  if (!name) {
    return null;
  }

  const idSource =
    pickString(record.id, record.key, record.slug, record.manualKey, record.manual_key) ?? `${context.weekId}-${name}`;
  const id = slugify(idSource, `item-${context.weekIndex + 1}-${context.itemIndex + 1}`);

  const checks = normalizeChecks(record);
  const manualFlag = record.manual === true || (record.manual !== false && checks.length === 0);

  const item = { id, name, checks };

  const done = coerceBoolean(
    record.done ?? record.complete ?? record.completed ?? record.finished ?? record.status ?? record.state,
  );
  if (done !== undefined) {
    item.done = done;
  }

  if (manualFlag) {
    item.manual = true;
  }

  const note = pickString(record.note, record.notes, record.description, record.detail);
  if (note) {
    item.note = note;
  }

  const manualKey = pickString(record.manualKey, record.manual_key, record.key);
  if (manualKey) {
    item.manualKey = manualKey;
  }

  return item;
}

function flattenPhaseWeeks(roadmap) {
  if (!Array.isArray(roadmap)) return [];
  const weeks = [];

  roadmap.forEach((phaseEntry, phaseIndex) => {
    if (!phaseEntry || typeof phaseEntry !== 'object') return;
    const phase = phaseEntry;
    const phaseLabel = pickString(phase.phase, phase.title, phase.name, phase.label) || `Phase ${phaseIndex + 1}`;
    const milestones = asArray(phase.milestones ?? phase.weeks ?? phase.items);

    milestones.forEach((milestoneEntry, milestoneIndex) => {
      if (!milestoneEntry || typeof milestoneEntry !== 'object') return;
      const milestone = milestoneEntry;
      weeks.push({
        ...milestone,
        __phaseLabel: phaseLabel,
        __phaseIndex: phaseIndex,
        __milestoneIndex: milestoneIndex,
      });
    });
  });

  return weeks;
}

function extractWeekCandidates(doc) {
  if (!doc || typeof doc !== 'object') return [];

  if (Array.isArray(doc.weeks)) {
    return doc.weeks;
  }

  if (Array.isArray(doc.roadmap)) {
    return flattenPhaseWeeks(doc.roadmap);
  }

  if (Array.isArray(doc.phases)) {
    return flattenPhaseWeeks(doc.phases);
  }

  if (Array.isArray(doc)) {
    return doc;
  }

  return [];
}

function canonicalizeWeek(input, index) {
  if (!input || typeof input !== 'object') return null;
  const record = input;

  const phaseLabel = pickString(
    record.__phaseLabel,
    record.phase,
    record.phaseLabel,
    record.phase_title,
    record.phaseName,
  );
  const weekLabel = pickString(
    record.title,
    record.name,
    record.label,
    record.summary,
    record.heading,
    record.week,
    record.__weekLabel,
  );

  const title = [phaseLabel, weekLabel].filter(Boolean).join(' — ') || weekLabel || phaseLabel || `Week ${index + 1}`;
  const idSource = pickString(record.id, record.slug, record.key, record.week, title);
  const id = slugify(idSource || `week-${index + 1}`, `week-${index + 1}`);

  const collections = [record.items, record.tasks, record.entries, record.deliverables, record.goals];
  const rawItems = collections.flatMap((collection) => asArray(collection));

  const items = [];
  rawItems.forEach((entry, itemIndex) => {
    const normalized = canonicalizeItem(entry, { weekTitle: title, weekId: id, weekIndex: index, itemIndex });
    if (normalized) {
      items.push(normalized);
    }
  });

  if (!items.length) {
    return null;
  }

  return { id, title, items };
}

function normalizeRoadmapDocument(doc) {
  if (!doc || typeof doc !== 'object') {
    throw new Error('Roadmap YAML must parse into an object');
  }

  const weeks = extractWeekCandidates(doc).map((entry, index) => canonicalizeWeek(entry, index)).filter(Boolean);

  if (!weeks.length) {
    throw new Error('Roadmap YAML must include at least one week with items');
  }

  return { version: 1, weeks };
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function normalizeFiles(check) {
  const out = [];
  for (const key of ['files', 'globs']) {
    const values = asArray(check?.[key]);
    for (const v of values) {
      if (typeof v === 'string' && v.trim()) out.push(v.trim());
    }
  }
  if (typeof check?.detail === 'string') {
    const bits = check.detail
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    out.push(...bits);
  }
  return out;
}

function checkFilesExist(paths, projectRoot) {
  if (paths.length === 0) {
    return { ok: true, note: 'no files listed', missing: [] };
  }

  const missing = [];
  for (const rel of paths) {
    const target = path.join(projectRoot, rel);
    if (!fs.existsSync(target)) missing.push(rel);
  }

  if (missing.length > 0) {
    return { ok: false, note: `missing: ${missing.join(', ')}`, missing };
  }
  return { ok: true, note: `${paths.length} file(s) present`, missing: [] };
}

function parseProbeHeaders(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    try {
      return parseProbeHeaders(JSON.parse(trimmed));
    } catch (err) {
      if (!(err instanceof Error)) {
        // ignore non-Error
      }
    }
    const headers = {};
    for (const part of trimmed.split(/[\n;,]+/)) {
      const piece = part.trim();
      if (!piece) continue;
      const idx = piece.indexOf(':');
      if (idx === -1) continue;
      const key = piece.slice(0, idx).trim();
      const value = piece.slice(idx + 1).trim();
      if (key && value) headers[key] = value;
    }
    return headers;
  }
  if (typeof raw === 'object') {
    const headers = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string' && value.trim()) headers[key.trim()] = value.trim();
    }
    return headers;
  }
  return {};
}

function searchContainer(query, container) {
  if (!container) return undefined;
  if (typeof container === 'boolean') return container;
  if (Array.isArray(container)) {
    for (const entry of container) {
      if (!entry || typeof entry !== 'object') continue;
      const candidates = [entry.q, entry.query, entry.symbol, entry.id, entry.identifier, entry.name];
      if (candidates.includes(query) && typeof entry.ok === 'boolean') return entry.ok;
      const nested = searchContainer(query, entry);
      if (typeof nested === 'boolean') return nested;
    }
    return undefined;
  }
  if (typeof container === 'object') {
    if (typeof container.ok === 'boolean') return container.ok;
    if (query in container) {
      const direct = container[query];
      if (typeof direct === 'boolean') return direct;
      if (direct && typeof direct === 'object' && typeof direct.ok === 'boolean') return direct.ok;
    }
    for (const value of Object.values(container)) {
      const nested = searchContainer(query, value);
      if (typeof nested === 'boolean') return nested;
    }
  }
  return undefined;
}

function extractOk(query, payload) {
  if (typeof payload === 'boolean') return payload;
  if (!payload) return undefined;
  if (typeof payload === 'object') {
    if (typeof payload.ok === 'boolean') return payload.ok;
    const containers = [];
    if (Array.isArray(payload)) containers.push(payload);
    if (payload.checks) containers.push(payload.checks);
    if (payload.results) containers.push(payload.results);
    if (payload.result) containers.push(payload.result);
    if (payload.data) containers.push(payload.data);
    if (payload.data && payload.data.results) containers.push(payload.data.results);
    if (payload.payload) containers.push(payload.payload);
    for (const container of containers) {
      const matched = searchContainer(query, container);
      if (typeof matched === 'boolean') return matched;
    }
  }
  return undefined;
}

async function httpOk(check, fetchImpl) {
  const url = typeof check?.url === 'string' ? check.url : '';
  if (!url) {
    return { ok: false, error: 'http_ok check missing url' };
  }
  const mustMatchRaw = check?.must_match;
  const mustMatch = Array.isArray(mustMatchRaw)
    ? mustMatchRaw.filter((item) => typeof item === 'string')
    : typeof mustMatchRaw === 'string'
      ? [mustMatchRaw]
      : [];
  try {
    const response = await fetchImpl(url, { cache: 'no-store' });
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        code: response.status,
        error: text || response.statusText,
        note: `HTTP ${response.status}`,
      };
    }
    const missing = mustMatch.filter((needle) => !text.includes(needle));
    const matched = missing.length === 0;
    return {
      ok: matched,
      code: response.status,
      matched,
      missing,
      note: `HTTP ${response.status}${matched ? '' : ` missing ${missing.join(', ')}`}`.trim(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, note: message };
  }
}

async function sqlExists(check, env, fetchImpl) {
  const query = typeof check?.query === 'string' && check.query.trim()
    ? check.query.trim()
    : undefined;
  if (!query) {
    return { ok: false, error: 'sql_exists check missing query' };
  }
  const url = env?.READ_ONLY_CHECKS_URL;
  if (!url) {
    return { ok: false, error: 'READ_ONLY_CHECKS_URL not set' };
  }
  const headers = { 'content-type': 'application/json', ...parseProbeHeaders(env?.READ_ONLY_CHECKS_HEADERS) };
  const attempts = [
    { label: 'queries', body: JSON.stringify({ queries: [query] }) },
    { label: 'query', body: JSON.stringify({ query }) },
    { label: 'symbols', body: JSON.stringify({ symbols: [query] }) },
    { label: 'symbol', body: JSON.stringify({ symbol: query }) },
    { label: 'symbols_single', body: JSON.stringify({ symbols: query }) },
    { label: 'raw', body: JSON.stringify(query) },
  ];
  let lastError = '';
  let lastCode;
  for (const attempt of attempts) {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: attempt.body,
      });
      const text = await response.text();
      let json = null;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch (err) {
          const normalized = text.trim().toLowerCase();
          if (['ok', 'true', 'ok:true'].includes(normalized)) {
            return { ok: true, attempt: attempt.label, note: `read_only_checks via ${attempt.label}` };
          }
        }
      }
      const ok = extractOk(query, json);
      if (typeof ok === 'boolean') {
        const payload = json && typeof json === 'object' ? { response: json } : {};
        return {
          ok,
          attempt: attempt.label,
          note: `read_only_checks via ${attempt.label}`,
          ...payload,
        };
      }
      const detail =
        (json && (json.error || json.message)) ||
        (typeof text === 'string' ? text.trim() : '') ||
        `Unexpected response via ${attempt.label}`;
      if (!response.ok) {
        lastCode = response.status;
        lastError = `${response.status} ${detail}`.trim();
      } else {
        lastError = detail;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  const error = lastError || 'Unexpected response from read_only_checks';
  return {
    ok: false,
    ...(typeof lastCode === 'number' ? { code: lastCode } : {}),
    error,
    note: error,
  };
}

async function runCheck(check, context) {
  const type = String(check?.type || '').trim();
  if (!type) {
    return { ok: false, error: 'missing check type' };
  }
  if (type === 'files_exist') {
    const files = normalizeFiles(check);
    return { ...checkFilesExist(files, context.projectRoot), files };
  }
  if (type === 'http_ok') {
    return httpOk(check, context.fetch);
  }
  if (type === 'sql_exists') {
    return sqlExists(check, context.env, context.fetch);
  }
  return { ok: false, error: `unsupported check type: ${type}` };
}

export async function runRoadmapChecks({
  projectRoot = defaultProjectRoot,
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
  statusPath = path.join(projectRoot, 'docs', 'roadmap-status.json'),
  writeFile = true,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch implementation is required');
  }
  const roadmapPath = path.join(projectRoot, 'docs', 'roadmap.yml');
  const doc = readRoadmap(roadmapPath, projectRoot);
  const normalizedDoc = normalizeRoadmapDocument(doc);
  const weeks = Array.isArray(normalizedDoc.weeks) ? normalizedDoc.weeks : [];
  let failures = 0;
  const status = {
    generated_at: new Date().toISOString(),
    weeks: [],
  };

  for (const week of weeks) {
    const weekId = week?.id || week?.title || '(week)';
    const items = Array.isArray(week?.items) ? week.items : [];
    const statusWeek = {
      id: week?.id ?? null,
      title: week?.title ?? null,
      items: [],
    };
    for (const item of items) {
      const itemId = item?.id || item?.name || '(item)';
      const checks = Array.isArray(item?.checks) ? item.checks : [];
      let itemPassed = true;
      const checksOut = [];

      for (const check of checks) {
        const result = await runCheck(check, {
          projectRoot,
          env,
          fetch: fetchImpl,
        });
        const ok = typeof result.ok === 'boolean' ? result.ok : undefined;
        const note = result.note || result.error || null;
        const label = `${weekId} / ${itemId}`;
        if (ok === true) {
          logger?.log?.(`✅ ${label}${note ? ` — ${note}` : ''}`);
        } else {
          failures += 1;
          logger?.error?.(`❌ ${label}${note ? ` — ${note}` : ''}`);
          itemPassed = false;
        }
        const statusText = ok === undefined ? 'unknown' : ok ? 'pass' : 'fail';
        const record = {
          ...check,
          ...result,
          ...(ok !== undefined ? { ok } : {}),
          status: statusText,
          result: statusText,
        };
        checksOut.push(record);
      }
      statusWeek.items.push({
        id: item?.id ?? null,
        name: item?.name ?? null,
        done: itemPassed,
        checks: checksOut,
        results: checksOut,
      });
    }
    if (statusWeek.items.length > 0) status.weeks.push(statusWeek);
  }

  if (writeFile) {
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);
  }

  const relativeStatusPath = relativeToProject(statusPath, projectRoot);
  logger?.log?.(`\nWrote ${relativeStatusPath}`);

  return { status, failures, statusPath };
}

async function main() {
  const { failures } = await runRoadmapChecks();
  if (failures > 0) {
    console.error(`\n${failures} check${failures === 1 ? '' : 's'} failed.`);
    process.exit(1);
  }

  console.log('\nAll roadmap checks passed.');
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectRun) {
  main().catch((err) => {
    console.error('Roadmap check failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

export const __testUtils = {
  parseProbeHeaders,
  extractOk,
};
