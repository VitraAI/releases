#!/usr/bin/env node
// Renders a release to Slack Block Kit and posts it with chat.postMessage.
//
//   node scripts/post-slack.mjs 26.10.13 --dry-run   print the payload + a Block Kit Builder link
//   SLACK_TOKEN=xoxb-… SLACK_CHANNEL=C0123456789 node scripts/post-slack.mjs 26.10.13
//
// Flags:
//   --dry-run   don't post; print the blocks and a Block Kit Builder URL
//   --layout=compact|spaced|stacked   item spacing (see LAYOUTS)
//
// SLACK_TOKEN   xoxb- (bot) or xoxp- (user) token with chat:write; a bot must be in the channel.
//               SLACK_BOT_TOKEN is accepted too (the GitHub Action's secret name).
// SLACK_CHANNEL channel ID (C…), not the #name.
//
// Lists are real rich_text lists, so wrapped lines hang-indent and sub-points
// (item.children) nest one level in.
import { pathToFileURL } from 'node:url';

import { toPlain, toSlackElements } from './lib/inline.mjs';
import {
  PRODUCT,
  SITE_URL,
  formatDate,
  loadAreas,
  orderSections,
  readJson,
  releasePath,
} from './lib/release.mjs';
import { validateRelease } from './validate.mjs';

const MAX_BLOCKS = 50;
const areas = loadAreas();
/** Slack's required escapes for top-level `text` and mrkdwn. */
const slackEscape = (s) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const SPACER = { type: 'rich_text_section', elements: [{ type: 'text', text: '\n' }] };
/** A blank line between two items of a spaced layout. */
const GAP = { type: 'rich_text_section', elements: [{ type: 'text', text: ' ' }] };

/**
 * How a section's items are laid out:
 *   compact  one tight list; lead-in and body on one line
 *   spaced   a blank line between top-level items
 *   stacked  spaced, and the bold lead-in on its own line with the body under it
 */
export const LAYOUTS = ['compact', 'spaced', 'stacked'];
export const DEFAULT_LAYOUT = 'stacked';

/** Bold lead-in, then the body, as one list line's elements. */
function lineElements(entry, { stacked } = {}) {
  const els = [];
  if (entry.title) els.push(...toSlackElements(entry.title, { bold: true }));
  if (entry.title && entry.body) els.push({ type: 'text', text: stacked ? '\n' : ' ' });
  if (entry.body) els.push(...toSlackElements(entry.body));
  return els;
}

const list = (indent, sections) => ({
  type: 'rich_text_list',
  style: 'bullet',
  indent,
  elements: sections.map((elements) => ({ type: 'rich_text_section', elements })),
});

/** One rich_text block per section: heading, optional note, nested bullet lists. */
export function sectionBlock(section, layout = DEFAULT_LAYOUT) {
  const emoji = section.emoji ?? areas.byId.get(section.area)?.emoji ?? 'sparkles';
  const spaced = layout !== 'compact';
  const stacked = layout === 'stacked';
  const elements = [
    {
      type: 'rich_text_section',
      elements: [
        { type: 'emoji', name: emoji },
        { type: 'text', text: ` ${section.title}`, style: { bold: true } },
      ],
    },
  ];
  if (section.note) {
    elements.push({ type: 'rich_text_quote', elements: toSlackElements(section.note) });
  }

  // Consecutive top-level items share one list; an item's children break it
  // with an indented list, and the next item opens a fresh top-level list.
  // Spaced layouts close the list after every item and put a blank line in
  // between: Slack has no list spacing of its own.
  let run = [];
  const flush = () => {
    if (run.length) elements.push(list(0, run));
    run = [];
  };
  section.items.forEach((item, i) => {
    run.push(lineElements(item, { stacked }));
    if (item.children?.length) {
      flush();
      elements.push(
        list(
          1,
          item.children.map((c) => lineElements(c)),
        ),
      );
    }
    if (spaced && i < section.items.length - 1) {
      flush();
      elements.push(GAP);
    }
  });
  flush();
  // Slack drops a trailing newline after a list, so consecutive sections ran
  // together; a line of its own gives each section a blank line below it.
  elements.push(SPACER);

  return { type: 'rich_text', block_id: `s-${section.id}`, elements };
}

/** The full message: header, sections (highlights first), divider, fixes, footer. */
export function renderBlocks(release, { layout = DEFAULT_LAYOUT } = {}) {
  const sections = orderSections(release);
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `:rocket: ${PRODUCT} — Release, ${formatDate(release.date)}`,
        emoji: true,
      },
    },
  ];
  sections.forEach((s, i) => {
    // Compact: a divider only before Fixes. Spaced layouts already use a blank
    // line between items, so a blank line can't mark a new section; a divider
    // between every section keeps the headings readable.
    if (s.area === 'fixes' || (layout !== 'compact' && i > 0)) blocks.push({ type: 'divider' });
    blocks.push(sectionBlock(s, layout));
  });
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Release v${release.id} · <${SITE_URL}/#${release.id}|What's new>`,
      },
    ],
  });
  return blocks;
}

/** Splits into messages of ≤50 blocks; messages after the first go in the thread. */
export function chunkBlocks(blocks) {
  const chunks = [];
  for (let i = 0; i < blocks.length; i += MAX_BLOCKS) chunks.push(blocks.slice(i, i + MAX_BLOCKS));
  return chunks;
}

export const fallbackText = (release) =>
  slackEscape(`${PRODUCT} — Release, ${formatDate(release.date)}: ${toPlain(release.summary)}`);

async function post(token, payload) {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!body.ok) {
    const detail = body.response_metadata?.messages?.join('; ') ?? '';
    throw new Error(`Slack: ${body.error}${detail ? ` — ${detail}` : ''}`);
  }
  return body;
}

async function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const [id] = argv.filter((a) => !a.startsWith('--'));
  if (!id) {
    console.error('usage: post-slack.mjs <id> [--dry-run] [--layout=stacked|spaced|compact]');
    process.exit(2);
  }
  const release = readJson(releasePath(id));
  const errors = validateRelease(release, `${id}.json`);
  if (errors.length) {
    console.error(`✗ ${id}.json is invalid:\n    ${errors.join('\n    ')}`);
    process.exit(1);
  }

  const layoutFlag = [...flags].find((f) => f.startsWith('--layout='));
  const layout = layoutFlag ? layoutFlag.slice('--layout='.length) : DEFAULT_LAYOUT;
  if (!LAYOUTS.includes(layout)) {
    console.error(`--layout must be one of: ${LAYOUTS.join(', ')}`);
    process.exit(2);
  }
  const blocks = renderBlocks(release, { layout });
  const chunks = chunkBlocks(blocks);
  const text = fallbackText(release);

  if (flags.has('--dry-run')) {
    console.log(JSON.stringify({ text, blocks }, null, 2));
    console.error(`\n${blocks.length} blocks in ${chunks.length} message(s).`);
    console.error('Preview (paste into a browser where you are signed in to Slack):');
    console.error(
      `https://app.slack.com/block-kit-builder/#${encodeURIComponent(JSON.stringify({ blocks: chunks[0] }))}`,
    );
    return;
  }

  if (release.backfill) {
    console.error(`${id} is a backfilled release; it is never posted to Slack.`);
    process.exit(1);
  }
  const token = process.env.SLACK_TOKEN || process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL;
  if (!token || !channel) {
    console.error('Set SLACK_TOKEN (xoxb-… or xoxp-…) and SLACK_CHANNEL (channel ID, C…).');
    process.exit(2);
  }

  let threadTs;
  for (const [i, chunk] of chunks.entries()) {
    const res = await post(token, {
      channel,
      text: i === 0 ? text : `${slackEscape(release.title)} (continued)`,
      blocks: chunk,
      unfurl_links: false,
      unfurl_media: false,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    });
    threadTs ??= res.ts;
    console.log(JSON.stringify({ ok: res.ok, channel: res.channel, ts: res.ts }));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
