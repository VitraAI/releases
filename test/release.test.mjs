import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertNoInternal, buildFeed, feedItem } from '../scripts/build.mjs';
import { classifyFiles, parseMrUrl } from '../scripts/collect-mrs.mjs';
import { parseInline, toHtml, toSlackElements } from '../scripts/lib/inline.mjs';
import {
  compareIdsDesc,
  idForDate,
  labelForId,
  listReleaseFiles,
  orderSections,
  publicRelease,
  readJson,
} from '../scripts/lib/release.mjs';
import { chunkBlocks, renderBlocks, sectionBlock } from '../scripts/post-slack.mjs';
import { parseMrDetails } from '../scripts/update-mrs.mjs';
import { validateRelease } from '../scripts/validate.mjs';

const base = () => ({
  schema: 1,
  id: '26.10.22',
  date: '2026-10-22',
  title: 'A release',
  summary: 'A summary that is long enough.',
  backfill: true,
  highlights: ['cosmos', 'projects'],
  sections: [
    {
      id: 'fixes',
      area: 'fixes',
      kind: 'fixed',
      title: 'Fixes',
      items: [{ body: 'A fix.' }, { body: 'Another fix.' }],
    },
    {
      id: 'projects',
      area: 'projects',
      kind: 'added',
      title: 'Projects',
      items: [{ title: 'Lead.', body: 'Body with `code`.' }],
    },
    {
      id: 'cosmos',
      area: 'cosmos',
      kind: 'changed',
      title: 'Cosmos',
      note: 'For workflow builders.',
      items: [{ title: 'Pipeline.' }],
    },
  ],
});

describe('inline markdown', () => {
  it('parses bold, italic, code and links', () => {
    const runs = parseInline('a **b _c_** `d` [e](https://x.io) f');
    assert.deepEqual(
      runs.map((r) => [r.text, r.style, r.url]),
      [
        ['a ', {}, undefined],
        ['b ', { bold: true }, undefined],
        ['c', { bold: true, italic: true }, undefined],
        [' ', {}, undefined],
        ['d', { code: true }, undefined],
        [' ', {}, undefined],
        ['e', {}, 'https://x.io'],
        [' f', {}, undefined],
      ],
    );
  });

  it('leaves snake_case alone', () => {
    assert.equal(parseInline('fk_project_id stays').length, 1);
  });

  it('throws on an unclosed marker', () => {
    assert.throws(() => parseInline('**open'));
    assert.throws(() => parseInline('`open'));
  });

  it('escapes HTML', () => {
    assert.equal(toHtml('**a & b**'), '<strong>a &amp; b</strong>');
  });

  it('adds a style to every Slack run', () => {
    assert.deepEqual(toSlackElements('x `y`', { bold: true }), [
      { type: 'text', text: 'x ', style: { bold: true } },
      { type: 'text', text: 'y', style: { bold: true, code: true } },
    ]);
  });
});

describe('ids and labels', () => {
  it('maps ids to labels and back', () => {
    assert.equal(labelForId('26.10.22'), 'release::2026-10-22');
    assert.equal(labelForId('26.10.22.2'), 'release::2026-10-22.2');
    assert.equal(idForDate('2026-10-22'), '26.10.22');
    assert.equal(idForDate('2026-10-22', 2), '26.10.22.2');
  });

  it('accepts only CalVer YY.0M.0D ids', () => {
    const long = base();
    long.id = '2026.10.22';
    assert.match(validateRelease(long).join('\n'), /\/id must match pattern/);
  });

  it('sorts newest first, same-day suffix after the plain id', () => {
    const ids = ['26.09.28', '26.10.13', '26.09.28.2'];
    assert.deepEqual(ids.sort(compareIdsDesc), ['26.10.13', '26.09.28.2', '26.09.28']);
  });
});

describe('publicRelease', () => {
  it('drops repo-only fields and keeps every section', () => {
    const pub = publicRelease(base());
    assert.equal(pub.backfill, undefined);
    assert.equal(pub.sections.length, 3);
    assertNoInternal(pub);
  });
});

describe('validateRelease', () => {
  it('accepts a good release', () => {
    assert.deepEqual(validateRelease(base(), '26.10.22.json'), []);
  });

  it('rejects a mismatched file name, date, area and highlight', () => {
    const r = base();
    r.date = '2026-10-21';
    r.sections[1].area = 'nope';
    r.highlights = ['missing'];
    const errors = validateRelease(r, 'wrong.json').join('\n');
    assert.match(errors, /file name/);
    assert.match(errors, /does not match id/);
    assert.match(errors, /unknown area/);
    assert.match(errors, /no section "missing"/);
  });

  it('rejects HTML and newlines in text', () => {
    const r = base();
    r.sections[1].items[0].body = 'a <b>';
    assert.notDeepEqual(validateRelease(r), []);
  });

  it('rejects internal-only fields: the repo is public', () => {
    const withAudience = base();
    withAudience.sections[0].audience = 'internal';
    assert.notDeepEqual(validateRelease(withAudience), []);
    const withRepos = base();
    withRepos.repos = [{ repo: 'universe-3-0-server', mr: 1 }];
    assert.notDeepEqual(validateRelease(withRepos), []);
  });

  it('keeps notes short: one-line items, no sub-lists, capped sections', () => {
    const r = base();
    r.summary = 'x'.repeat(161);
    r.sections[1].items[0].body = Array.from({ length: 15 }, () => 'word').join(' ');
    r.sections[1].items[0].children = [{ body: 'A child.' }];
    r.sections[2].items = Array.from({ length: 6 }, () => ({ body: 'An item.' }));
    r.sections.push(
      ...['a', 'b'].map((id) => ({
        id,
        area: 'projects',
        kind: 'added',
        title: `Section ${id}`,
        items: [{ body: 'An item.' }],
      })),
    );
    const errors = validateRelease(r, '26.10.22.json').join('\n');
    assert.match(errors, /\/summary: 161 characters/);
    assert.match(errors, /items\/0: 16 words/);
    assert.match(errors, /no sub-lists/);
    assert.match(errors, /6 items/);
    assert.match(errors, /4 feature sections/);
  });

  it('accepts every committed release file', () => {
    for (const file of listReleaseFiles()) {
      const name = file.split('/').pop();
      assert.deepEqual(validateRelease(readJson(file), name), [], name);
    }
  });
});

describe('build', () => {
  it('puts More updates after the other sections and before fixes', () => {
    const r = base();
    r.sections.splice(1, 0, {
      id: 'more',
      area: 'improvements',
      kind: 'changed',
      title: 'More updates',
      items: [{ body: 'An update.' }],
    });
    r.highlights = [];
    assert.deepEqual(
      orderSections(r).map((s) => s.id),
      ['projects', 'cosmos', 'more', 'fixes'],
    );
  });

  it('orders highlights first and fixes last', () => {
    assert.deepEqual(
      orderSections(base()).map((s) => s.id),
      ['cosmos', 'projects', 'fixes'],
    );
  });

  it('emits a JSON Feed 1.1 item and publishes only the areas it uses', () => {
    const item = feedItem(base());
    assert.equal(item.date_published, '2026-10-22T12:00:00+05:30');
    assert.ok(item.content_html.includes('<code>code</code>'));
    assert.deepEqual(
      buildFeed([base()])._universe.areas.map((a) => a.id),
      ['projects', 'cosmos', 'fixes'],
    );
    assertNoInternal(item);
  });

  it('builds a feed from every committed release without leaks', () => {
    const feed = buildFeed(listReleaseFiles().map(readJson));
    assert.equal(feed.version, 'https://jsonfeed.org/version/1.1');
    const used = new Set(feed.items.flatMap((i) => i._universe.sections.map((s) => s.area)));
    assert.deepEqual(
      feed._universe.areas.map((a) => a.id).filter((id) => !used.has(id)),
      [],
    );
    assertNoInternal(feed);
  });
});

describe('slack', () => {
  it('nests children one level in', () => {
    const section = base().sections[1];
    section.items[0].children = [{ body: 'First child.' }, { body: 'Second child.' }];
    const block = sectionBlock(section);
    const lists = block.elements.filter((e) => e.type === 'rich_text_list');
    assert.deepEqual(
      lists.map((l) => l.indent),
      [0, 1],
    );
  });

  it('stacked (default) puts the body under the lead-in and divides every section', () => {
    const block = sectionBlock(base().sections[1]);
    assert.ok(JSON.stringify(block).includes('{"type":"text","text":"\\n"}'));
    const types = renderBlocks(base()).map((b) => b.type);
    assert.equal(types.filter((t) => t === 'divider').length, 2);
  });

  it('compact renders a divider only before fixes', () => {
    const blocks = renderBlocks(base(), { layout: 'compact' });
    const types = blocks.map((b) => b.type);
    assert.equal(types[0], 'header');
    assert.equal(types.at(-1), 'context');
    assert.equal(types[types.indexOf('divider') + 1], 'rich_text');
    assert.ok(JSON.stringify(blocks).includes('Pipeline.'));
    assert.equal(blocks.filter((b) => b.type === 'divider').length, 1);
  });

  it('chunks at 50 blocks', () => {
    assert.deepEqual(
      chunkBlocks(Array.from({ length: 120 })).map((c) => c.length),
      [50, 50, 20],
    );
  });
});

describe('collect-mrs helpers', () => {
  it('parses MR URLs', () => {
    assert.deepEqual(parseMrUrl('https://gitlab.com/a/b/c/-/merge_requests/42/diffs'), {
      path: 'a/b/c',
      iid: 42,
    });
  });

  it('classifies deploy-relevant files', () => {
    const s = classifyFiles([
      'src/migrations/20261022-add.js',
      'env.ts',
      '.gitlab-ci.yml',
      'package.json',
      'src/app.ts',
    ]);
    assert.deepEqual(s.migrations, ['src/migrations/20261022-add.js']);
    assert.deepEqual(s.env, ['env.ts']);
    assert.deepEqual(s.infra, ['.gitlab-ci.yml']);
    assert.deepEqual(s.dependencies, ['package.json']);
  });
});

describe('update-mrs parser', () => {
  const F = '```';
  const section = (
    n,
    iid,
    { title = 'chore(release): 2026-10-24 — a, b', body = '## Summary\nText.' } = {},
  ) =>
    `## ${n}. repo-${n} — !${iid}\n\nMR: https://gitlab.com/g/repo-${n}/-/merge_requests/${iid}\n\n` +
    `### Title\n\n${F}\n${title}\n${F}\n\n### Description\n\n${F}markdown\n${body}\n${F}\n`;
  const doc = (...parts) => `# Release 2026-10-24\n\nIntro.\n\n---\n\n${parts.join('\n---\n\n')}`;

  it('reads each section title and description', () => {
    const mrs = parseMrDetails(
      doc(section(1, 7), section(2, 8, { body: '## Summary\nTwo.\n\n- `x`' })),
    );
    assert.deepEqual(
      mrs.map((m) => [m.repo, m.iid, m.title, m.description]),
      [
        ['repo-1', 7, 'chore(release): 2026-10-24 — a, b', '## Summary\nText.'],
        ['repo-2', 8, 'chore(release): 2026-10-24 — a, b', '## Summary\nTwo.\n\n- `x`'],
      ],
    );
  });

  it('refuses malformed sections before anything is written', () => {
    assert.throws(() => parseMrDetails('# nothing'), /no "## <n>/);
    assert.throws(
      () => parseMrDetails(doc(section(1, 7, { title: 'feat: x' }))),
      /chore\(release\)/,
    );
    assert.throws(
      () => parseMrDetails(doc(section(1, 7, { title: `chore(release): ${'x'.repeat(90)}` }))),
      /100 characters/,
    );
    assert.throws(
      () => parseMrDetails(doc(section(1, 7, { body: `## Summary\n${F}js\nx\n${F}` }))),
      /nested/,
    );
    assert.throws(
      () => parseMrDetails(doc(section(1, 7), section(2, 7).replaceAll('repo-2', 'repo-1'))),
      /twice/,
    );
    assert.throws(() => parseMrDetails(doc(section(1, 7).replace('!7', '!9'))), /MR link is !7/);
  });
});
