#!/usr/bin/env node
// scripts/roadmap-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roadmapPath = path.join(projectRoot, 'docs', 'roadmap.yml');

function relative(p) {
  return path.relative(projectRoot, p) || '.';
}

function readRoadmap(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing roadmap file at ${relative(file)}`);
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

function checkFilesExist(paths) {
  if (paths.length === 0) {
    return { ok: true, note: 'no files listed' };
  }

  const missing = [];
  for (const rel of paths) {
    const target = path.join(projectRoot, rel);
    if (!fs.existsSync(target)) missing.push(rel);
  }

  if (missing.length > 0) {
    return { ok: false, note: `missing: ${missing.join(', ')}` };
  }
  return { ok: true, note: `${paths.length} file(s) present` };
}

function runCheck(check) {
  const type = String(check?.type || '').trim();
  if (type === 'files_exist') {
    const files = normalizeFiles(check);
    return checkFilesExist(files);
  }
  return { ok: false, note: `unsupported check type: ${type || 'unknown'}` };
}

function main() {
  const doc = readRoadmap(roadmapPath);
  const weeks = Array.isArray(doc.weeks) ? doc.weeks : [];
  let failures = 0;

  for (const week of weeks) {
    const weekId = week?.id || week?.title || '(week)';
    const items = Array.isArray(week?.items) ? week.items : [];
    for (const item of items) {
      const itemId = item?.id || item?.name || '(item)';
      const checks = Array.isArray(item?.checks) ? item.checks : [];
      if (checks.length === 0) continue;

      for (const check of checks) {
        const { ok, note } = runCheck(check);
        const label = `${weekId} / ${itemId}`;
        if (ok) {
          console.log(`✅ ${label}${note ? ` — ${note}` : ''}`);
        } else {
          failures += 1;
          console.error(`❌ ${label}${note ? ` — ${note}` : ''}`);
        }
      }
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} check${failures === 1 ? '' : 's'} failed.`);
    process.exit(1);
  }

  console.log('\nAll roadmap checks passed.');
}

try {
  main();
} catch (err) {
  console.error('Roadmap check failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}
