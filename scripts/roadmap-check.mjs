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
  const weeks = Array.isArray(doc.weeks) ? doc.weeks : [];
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
