#!/usr/bin/env node
// Collects a release's GitLab MRs into .work/<id>/ (gitignored: MR text and
// diffs carry infra, env and migration details that must never be published).
//
//   node scripts/collect-mrs.mjs 26.10.22                    MRs labelled release::2026-10-22
//   node scripts/collect-mrs.mjs 26.10.22 --diffs            …plus commits, diffs and signals
//   node scripts/collect-mrs.mjs 26.10.22 --url <mr-url> …   these MRs instead of the label
//
// Auth: GITLAB_TOKEN (read_api), else the token `glab auth login` stored (see lib/gitlab.mjs).
//
// Writes .work/<id>/mrs.json and, with --diffs, .work/<id>/diffs/<repo>-<iid>.diff.
// `signals` per MR lists the files that usually mean a deploy step: migrations,
// env/config, CI/infra and dependency changes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { api, config, gitlabToken } from './lib/gitlab.mjs';
import { ROOT, labelForId } from './lib/release.mjs';

/** File-path patterns that usually need a line in the MR description. */
export const SIGNALS = {
  migrations: [/(^|\/)migrations?\//i, /\.sql$/i],
  env: [
    /(^|\/)\.env[^/]*$/i,
    /(^|\/)env\.(ts|js|mjs)$/i,
    /(^|\/)config\/[^/]*\.(ts|js|json|ya?ml)$/i,
  ],
  infra: [
    /(^|\/)\.gitlab-ci\.yml$/i,
    /(^|\/)\.github\/workflows\//i,
    /(^|\/)Dockerfile[^/]*$/i,
    /(^|\/)(docker-)?compose[^/]*\.ya?ml$/i,
    /(^|\/)infra(structure)?\//i,
    /\.sh$/i,
  ],
  dependencies: [
    /(^|\/)package(-lock)?\.json$/i,
    /(^|\/)pnpm-lock\.yaml$/i,
    /(^|\/)requirements[^/]*\.txt$/i,
  ],
};

export function classifyFiles(paths) {
  const out = Object.fromEntries(Object.keys(SIGNALS).map((k) => [k, []]));
  for (const path of paths) {
    for (const [kind, patterns] of Object.entries(SIGNALS)) {
      if (patterns.some((re) => re.test(path))) out[kind].push(path);
    }
  }
  return out;
}

/** https://gitlab.com/<path>/-/merge_requests/<iid> → { path, iid } */
export function parseMrUrl(url) {
  const m = /^https:\/\/[^/]+\/(.+?)\/-\/merge_requests\/(\d+)/.exec(url);
  if (!m) throw new Error(`not a GitLab MR URL: ${url}`);
  return { path: m[1], iid: Number(m[2]) };
}

const enc = encodeURIComponent;
const repoFor = (path) =>
  config.projects.find((p) => p.path === path)?.repo ?? path.split('/').pop();

async function main(argv) {
  const flags = new Set(argv.filter((a) => a === '--diffs'));
  const urls = argv.flatMap((a, i) => (argv[i - 1] === '--url' ? [a] : []));
  const [id] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--url');
  if (!id || !/^\d{2}\.\d{2}\.\d{2}(\.\d)?$/.test(id)) {
    console.error('usage: collect-mrs.mjs <YY.MM.DD[.N]> [--diffs] [--url <mr-url> ...]');
    process.exit(2);
  }
  const { get } = api(gitlabToken());
  const label = labelForId(id);

  /** @type {{ path: string, iid: number }[]} */
  let refs;
  if (urls.length) {
    refs = urls.map(parseMrUrl);
  } else {
    refs = [];
    for (const p of config.projects) {
      const mrs = await get(
        `/projects/${enc(p.path)}/merge_requests?labels=${enc(label)}&state=all`,
        {
          all: true,
        },
      );
      refs.push(...mrs.map((mr) => ({ path: p.path, iid: mr.iid })));
    }
    if (!refs.length) {
      console.error(
        `No MRs labelled ${label} in: ${config.projects.map((p) => p.repo).join(', ')}.\n` +
          `Add the label to each release MR (staging → main), or pass --url for each MR.`,
      );
      process.exit(1);
    }
  }

  const dir = join(ROOT, '.work', id);
  mkdirSync(join(dir, 'diffs'), { recursive: true });

  const mrs = [];
  for (const { path, iid } of refs) {
    const base = `/projects/${enc(path)}/merge_requests/${iid}`;
    const mr = await get(base);
    const commits = await get(`${base}/commits`, { all: true });
    const entry = {
      repo: repoFor(path),
      project: path,
      iid,
      url: mr.web_url,
      title: mr.title,
      description: mr.description ?? '',
      state: mr.state,
      merged_at: mr.merged_at,
      source_branch: mr.source_branch,
      target_branch: mr.target_branch,
      labels: mr.labels,
      commits: commits
        .filter((c) => (c.parent_ids?.length ?? 1) < 2)
        .map((c) => ({ sha: c.short_id, title: c.title })),
    };

    if (flags.has('--diffs')) {
      const diffs = await get(`${base}/diffs`, { all: true });
      const files = diffs.map((d) => d.new_path);
      entry.files = diffs.map((d) => ({
        path: d.new_path,
        ...(d.renamed_file ? { renamed_from: d.old_path } : {}),
        status: d.new_file
          ? 'added'
          : d.deleted_file
            ? 'deleted'
            : d.renamed_file
              ? 'renamed'
              : 'modified',
      }));
      entry.signals = classifyFiles(files);
      const patch = diffs
        .map(
          (d) =>
            `diff --git a/${d.old_path} b/${d.new_path}\n--- a/${d.old_path}\n+++ b/${d.new_path}\n${d.diff}`,
        )
        .join('\n');
      const file = join(dir, 'diffs', `${entry.repo}-${iid}.diff`);
      writeFileSync(file, patch);
      entry.diff_file = file;
    }
    mrs.push(entry);
  }

  writeFileSync(join(dir, 'mrs.json'), `${JSON.stringify({ id, label, mrs }, null, 2)}\n`);

  console.log(`${mrs.length} MR(s) for ${id} → .work/${id}/mrs.json\n`);
  for (const m of mrs) {
    const warn = [];
    if (m.state !== 'merged') warn.push(m.state);
    if (m.target_branch !== 'main') warn.push(`targets ${m.target_branch}`);
    const sig = m.signals
      ? Object.entries(m.signals)
          .filter(([, f]) => f.length)
          .map(([k, f]) => `${k}:${f.length}`)
          .join(' ')
      : '';
    console.log(
      `  ${m.repo} !${m.iid}  ${m.commits.length} commits  ${m.title}` +
        (sig ? `\n      signals ${sig}` : '') +
        (warn.length ? `\n      ⚠ ${warn.join(', ')}` : ''),
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
