#!/usr/bin/env node
/**
 * check-subrequest-fanout — flag per-item external-call fan-outs that scale with data size.
 *
 * Cloudflare Workers cap subrequests per invocation (50 free / 1000 paid). Looping an external call
 * (fetch / AI / Stripe / push / ES) once per row reintroduces an unbounded fan-out that eventually
 * exceeds the cap as the userbase/data grows. This gate greps for the concurrency-loop markers that
 * usually wrap such fan-outs and fails CI unless the site is explicitly annotated as safe.
 *
 * Markers: `runWithConcurrency(`, `PromisePool`, `.withConcurrency(`.
 *
 * To allow a genuinely-safe site (e.g. the loop body only writes to the DB over TCP, which is NOT a
 * subrequest, or the iteration count is hard-capped), put `subrequest-ok` in a comment on the same
 * line or the line immediately above. Prefer a short reason, e.g. `// subrequest-ok: DB writes only`.
 *
 * Usage:
 *   node node_modules/@rdlabo/workers-hono-kit/scripts/check-subrequest-fanout.mjs [dir ...]
 * Defaults to scanning `src`. Exits 1 if any un-annotated marker is found.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MARKER = /runWithConcurrency\(|PromisePool|\.withConcurrency\(/;
const ALLOW = /subrequest-ok/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage']);

/** Recursively collect .ts files (excluding *.spec.ts / *.test.ts). */
function collect(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) {
        out.push(...collect(full));
      }
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

const targets = process.argv.slice(2);
const roots = targets.length > 0 ? targets : ['src'];

const violations = [];
for (const root of roots) {
  for (const file of collect(root)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!MARKER.test(line)) {
        return;
      }
      // Only flag executable code, not porting notes / JSDoc that merely mention the markers.
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        return;
      }
      const prev = i > 0 ? lines[i - 1] : '';
      if (ALLOW.test(line) || ALLOW.test(prev)) {
        return;
      }
      violations.push({ file, line: i + 1, text: trimmed });
    });
  }
}

if (violations.length > 0) {
  console.error('✖ subrequest fan-out gate: un-annotated concurrency loop(s) found.');
  console.error('  Each may loop an external call per item (fetch/AI/Stripe/push/ES) and blow the');
  console.error('  Workers subrequest cap as data grows. Move it behind a queue / cap it, or, if the');
  console.error('  loop body is DB-only or hard-capped, annotate with `// subrequest-ok: <reason>`.\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  process.exit(1);
}

console.log('✓ subrequest fan-out gate: no un-annotated concurrency loops.');
