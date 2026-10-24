#!/usr/bin/env node
// SOP step 2: sets each release MR's title and description from the file
// /mr-details wrote (.work/<id>/mr-details.md).
//
//   node scripts/update-mrs.mjs 2026.10.22             update every MR in the file
//   node scripts/update-mrs.mjs 2026.10.22 --dry-run   parse and check only, no writes
//
// Auth: GITLAB_TOKEN (api), else the token `glab auth login` stored.
//
// Every section is parsed and checked before anything is written. Before the
// first write to an MR, its live title and description are saved to
// .work/<id>/previous-descriptions.json; an MR already in that file keeps its
// first saved copy, so re-running never loses the author's original text.
// After each write the MR is read back and compared.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseMrUrl } from './collect-mrs.mjs';
import { api, gitlabToken } from './lib/gitlab.mjs';
import { ROOT, readJson } from './lib/release.mjs';

const FENCE = '```';

/**
 * Splits mr-details.md into its MR sections. Throws on the first malformed one,
 * naming it, so a broken file never reaches GitLab half-applied.
 * @returns {{ repo: string, iid: number, url: string, title: string, description: string }[]}
 */
export function parseMrDetails(md) {
  const parts = md.split(/^(?=## \d+\. )/m).slice(1);
  if (!parts.length) throw new Error('no "## <n>. <repo> — !<iid>" sections found');
  const seen = new Set();
  return parts.map((part) => {
    const head = /^## \d+\. (.+?) — !(\d+)\s*$/m.exec(part);
    if (!head) throw new Error(`bad section heading: ${part.split('\n')[0]}`);
    const [, repo, iidText] = head;
    const where = `${repo} !${iidText}`;

    const url = /^MR: (\S+)\s*$/m.exec(part)?.[1];
    if (!url) throw new Error(`${where}: no "MR: <url>" line`);
    const { iid } = parseMrUrl(url);
    if (iid !== Number(iidText)) throw new Error(`${where}: MR link is !${iid}`);
    if (seen.has(url)) throw new Error(`${where}: MR appears twice`);
    seen.add(url);

    const title = new RegExp(`### Title\\s*\\n${FENCE}\\n(.+)\\n${FENCE}`).exec(part)?.[1].trim();
    if (!title) throw new Error(`${where}: no fenced Title`);
    if (!title.startsWith('chore(release): '))
      throw new Error(`${where}: title is not chore(release)`);
    if ([...title].length >= 100) throw new Error(`${where}: title is 100 characters or more`);

    const open = part.indexOf(`### Description\n\n${FENCE}markdown\n`);
    const close = part.lastIndexOf(`\n${FENCE}`);
    if (open < 0 || close <= open) throw new Error(`${where}: no fenced markdown Description`);
    const description = part
      .slice(part.indexOf('\n', part.indexOf(`${FENCE}markdown`, open)) + 1, close)
      .trimEnd();
    if (description.split('\n').some((l) => l.startsWith(FENCE))) {
      throw new Error(`${where}: description has a nested ${FENCE} fence`);
    }
    if (!description.startsWith('## Summary'))
      throw new Error(`${where}: description has no Summary`);

    return { repo, iid, url, title, description };
  });
}

async function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const [id] = argv.filter((a) => !a.startsWith('--'));
  if (!id || !/^\d{4}\.\d{2}\.\d{2}(\.\d)?$/.test(id)) {
    console.error('usage: update-mrs.mjs <YYYY.MM.DD[.N]> [--dry-run]');
    process.exit(2);
  }
  const dir = join(ROOT, '.work', id);
  const file = join(dir, 'mr-details.md');
  if (!existsSync(file))
    throw new Error(`.work/${id}/mr-details.md not found; run /mr-details first`);
  const sections = parseMrDetails(readFileSync(file, 'utf8'));

  if (dryRun) {
    console.log(`${sections.length} MR section(s) in .work/${id}/mr-details.md parse cleanly:\n`);
    for (const s of sections) console.log(`  ${s.repo} !${s.iid}  ${s.title}`);
    return;
  }

  const { get, put } = api(gitlabToken('api'));
  const backupFile = join(dir, 'previous-descriptions.json');
  const backup = existsSync(backupFile) ? readJson(backupFile) : { id, mrs: [] };
  const saveBackup = () => writeFileSync(backupFile, `${JSON.stringify(backup, null, 2)}\n`);

  console.log(`Updating ${sections.length} MR(s) from .work/${id}/mr-details.md\n`);
  for (const s of sections) {
    const { path } = parseMrUrl(s.url);
    const base = `/projects/${encodeURIComponent(path)}/merge_requests/${s.iid}`;
    const live = await get(base);

    if (!backup.mrs.some((m) => m.url === s.url)) {
      backup.mrs.push({
        repo: s.repo,
        iid: s.iid,
        url: s.url,
        title: live.title,
        description: live.description ?? '',
        saved_at: new Date().toISOString(),
      });
      saveBackup();
    }

    if (live.title === s.title && (live.description ?? '').trimEnd() === s.description) {
      console.log(`  ${s.repo} !${s.iid}  unchanged`);
      continue;
    }
    await put(base, { title: s.title, description: s.description });
    const after = await get(base);
    if (after.title !== s.title || (after.description ?? '').trimEnd() !== s.description) {
      throw new Error(`${s.repo} !${s.iid}: GitLab did not keep the new text; check ${s.url}`);
    }
    console.log(`  ${s.repo} !${s.iid}  updated (${live.state})`);
  }
  console.log(`\nPrevious titles and descriptions: .work/${id}/previous-descriptions.json`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
