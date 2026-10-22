import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RELEASES_DIR = join(ROOT, 'releases');

/** Where the build is published. Override for a fork or local preview. */
export const SITE_URL = (
  process.env.RELEASES_SITE_URL || 'https://vitraai.github.io/releases'
).replace(/\/+$/, '');

/** The product name used in Slack headers. */
export const PRODUCT = 'Universe 3.0';

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export function loadAreas() {
  const { areas } = readJson(join(ROOT, 'config', 'areas.json'));
  return { list: areas, byId: new Map(areas.map((a) => [a.id, a])) };
}

export function listReleaseFiles() {
  return readdirSync(RELEASES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => join(RELEASES_DIR, f));
}

export const releasePath = (id) => join(RELEASES_DIR, `${id}.json`);

/** release::2026-10-22 ↔ 2026.10.22 (and .2 for a second release that day). */
export function labelForId(id) {
  const [y, m, d, n] = id.split('.');
  return `release::${y}-${m}-${d}${n ? `.${n}` : ''}`;
}

export function idForDate(date, n) {
  return `${date.replaceAll('-', '.')}${n && n > 1 ? `.${n}` : ''}`;
}

/** Newest first: by date, then by same-day suffix. */
export function compareIdsDesc(a, b) {
  const key = (id) => {
    const [y, m, d, n = '1'] = id.split('.');
    return `${y}${m}${d}.${n.padStart(2, '0')}`;
  };
  return key(b).localeCompare(key(a));
}

/**
 * The published copy of a release: the source minus fields that only matter
 * in this repo (`backfill`, `$schema`). Every section and item is
 * customer-facing — the repo is public, so nothing internal is ever written.
 */
export function publicRelease(release) {
  const { backfill: _backfill, $schema: _schema, ...rest } = release;
  return { ...rest, highlights: release.highlights ?? [] };
}

/** Display order: highlighted sections first, the rest as written, fixes last. */
export function orderSections(release) {
  const highlights = release.highlights ?? [];
  const rank = (s) => {
    if (s.area === 'fixes') return 1e6;
    const h = highlights.indexOf(s.id);
    return h === -1 ? 1e3 : h;
  };
  return release.sections
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
    .map(({ s }) => s);
}

/** "13 Oct 2026" */
export function formatDate(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
