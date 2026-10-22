#!/usr/bin/env node
// Builds dist/ for GitHub Pages from releases/*.json:
//
//   feed.json          JSON Feed 1.1, newest first, customer-safe items only
//   <id>.json          one release, the same item as in the feed
//   index.html         a plain readable page of every release
//   schema/…           the source-file schema, for editors and consumers
//
// The repo is public and every release file is customer-facing; the build
// still refuses to publish any internal-only field (assertNoInternal).
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { escapeHtml, toHtml, toPlain } from './lib/inline.mjs';
import {
  ROOT,
  SITE_URL,
  compareIdsDesc,
  formatDate,
  listReleaseFiles,
  loadAreas,
  orderSections,
  publicRelease,
  readJson,
} from './lib/release.mjs';
import { validateRelease } from './validate.mjs';

const areas = loadAreas();

function itemHtml(item) {
  const lead = item.title ? `<strong>${toHtml(item.title)}</strong>` : '';
  const body = item.body ? toHtml(item.body) : '';
  const children = item.children?.length
    ? `<ul>${item.children.map((c) => `<li>${itemHtml(c)}</li>`).join('')}</ul>`
    : '';
  return [lead, body].filter(Boolean).join(' ') + children;
}

/** HTML body of one release, for feed readers, email and index.html. */
export function releaseHtml(release) {
  return orderSections(release)
    .map((s) => {
      const note = s.note ? `<p><em>${toHtml(s.note)}</em></p>` : '';
      const items = s.items.map((i) => `<li>${itemHtml(i)}</li>`).join('');
      return `<h3>${escapeHtml(s.title)}</h3>${note}<ul>${items}</ul>`;
    })
    .join('');
}

function releaseText(release) {
  const line = (i) => [i.title, i.body].filter(Boolean).map(toPlain).join(' ');
  return orderSections(release)
    .map((s) => {
      const items = s.items.flatMap((i) => [
        `- ${line(i)}`,
        ...(i.children ?? []).map((c) => `  - ${line(c)}`),
      ]);
      return [s.title, ...(s.note ? [toPlain(s.note)] : []), ...items].join('\n');
    })
    .join('\n\n');
}

/** A JSON Feed 1.1 item. Our structured sections ride in `_universe`. */
export function feedItem(source) {
  const r = publicRelease(source);
  const item = {
    id: r.id,
    url: `${SITE_URL}/#${r.id}`,
    title: r.title,
    summary: r.summary,
    content_html: releaseHtml(r),
    content_text: releaseText(r),
    date_published: `${r.date}T12:00:00+05:30`,
    tags: r.tags ?? [],
    _universe: {
      schema: r.schema,
      version: r.id,
      date: r.date,
      json_url: `${SITE_URL}/${r.id}.json`,
      highlights: r.highlights,
      sections: orderSections(r),
    },
  };
  if (r.image) item.image = r.image;
  return item;
}

export function buildFeed(sources) {
  const items = [...sources].sort((a, b) => compareIdsDesc(a.id, b.id)).map(feedItem);
  // Only areas a published section uses: an unused label (e.g. an area for a
  // feature not launched yet) would announce it to feed readers.
  const used = new Set(items.flatMap((i) => i._universe.sections.map((s) => s.area)));
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: "Universe — What's new",
    home_page_url: `${SITE_URL}/`,
    feed_url: `${SITE_URL}/feed.json`,
    description: 'Release notes for Vitra Universe.',
    language: 'en',
    _universe: {
      schema: 1,
      areas: areas.list
        .filter((a) => used.has(a.id))
        .map(({ id, label, icon }) => ({ id, label, icon })),
    },
    items,
  };
}

function indexHtml(feed) {
  const releases = feed.items
    .map(
      (i) => `<article id="${i.id}">
  <header><time datetime="${i._universe.date}">${formatDate(i._universe.date)}</time><h2><a href="#${i.id}">${escapeHtml(i.title)}</a></h2><p>${escapeHtml(i.summary)}</p></header>
  ${i.content_html}
</article>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>What's new</title>
<link rel="alternate" type="application/feed+json" title="What's new" href="feed.json">
<style>
  :root { color-scheme: light dark; --fg: #18181b; --muted: #52525b; --line: #e4e4e7; --bg: #fff; --accent: #4f46e5; }
  @media (prefers-color-scheme: dark) { :root { --fg: #f4f4f5; --muted: #a1a1aa; --line: #27272a; --bg: #0b0b0d; --accent: #a5b4fc; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 48px 16px; }
  h1 { font-size: 28px; margin: 0 0 4px; } main > p { color: var(--muted); margin: 0 0 40px; }
  article { border-top: 1px solid var(--line); padding: 32px 0; }
  time { color: var(--muted); font-size: 14px; } h2 { margin: 4px 0; font-size: 22px; } h2 a { color: inherit; text-decoration: none; }
  header p { color: var(--muted); margin: 0 0 8px; } h3 { font-size: 17px; margin: 24px 0 8px; }
  ul { padding-left: 22px; margin: 0; } li { margin: 6px 0; } li ul { margin-top: 4px; }
  a { color: var(--accent); } code { font-size: 0.9em; padding: 1px 4px; border-radius: 4px; background: var(--line); }
</style>
</head>
<body>
<main>
<h1>What's new</h1>
<p>Release notes for Vitra Universe · <a href="feed.json">JSON Feed</a></p>
${releases}
</main>
</body>
</html>
`;
}

/** Fails loudly if anything internal-only made it into the output. */
export function assertNoInternal(json) {
  const text = JSON.stringify(json);
  for (const key of ['"audience"', '"repos"', '"backfill"']) {
    if (text.includes(key)) throw new Error(`internal field ${key} leaked into the build`);
  }
}

function main() {
  const files = listReleaseFiles();
  const sources = [];
  let invalid = 0;
  for (const file of files) {
    const release = readJson(file);
    const errors = validateRelease(release, basename(file));
    if (errors.length) {
      invalid++;
      console.error(`✗ ${basename(file)}\n    ${errors.join('\n    ')}`);
    }
    sources.push(release);
  }
  if (invalid) {
    console.error(`\nBuild stopped: ${invalid} invalid release file(s). Run npm run validate.`);
    process.exit(1);
  }

  const out = join(ROOT, 'dist');
  if (existsSync(out)) rmSync(out, { recursive: true });
  mkdirSync(join(out, 'schema'), { recursive: true });

  const feed = buildFeed(sources);
  assertNoInternal(feed);
  writeFileSync(join(out, 'feed.json'), `${JSON.stringify(feed, null, 2)}\n`);
  for (const item of feed.items) {
    writeFileSync(join(out, `${item.id}.json`), `${JSON.stringify(item, null, 2)}\n`);
  }
  writeFileSync(join(out, 'index.html'), indexHtml(feed));
  writeFileSync(join(out, '.nojekyll'), '');
  cpSync(join(ROOT, 'schema', 'release.schema.json'), join(out, 'schema', 'release.schema.json'));

  console.log(
    `Built dist/ with ${feed.items.length} release(s): ${feed.items.map((i) => i.id).join(', ')}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
