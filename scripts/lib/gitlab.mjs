import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { ROOT, readJson } from './release.mjs';

export const config = readJson(join(ROOT, 'config', 'projects.json'));

/** GITLAB_TOKEN, else the token `glab auth login` stored. `scope` only shapes the error. */
export function gitlabToken(scope = 'read_api') {
  if (process.env.GITLAB_TOKEN) return process.env.GITLAB_TOKEN;
  const host = new URL(config.host).host;
  try {
    const token = execFileSync('glab', ['config', 'get', 'token', '--host', host], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (token) return token;
  } catch {
    // fall through
  }
  throw new Error(
    `No GitLab token. Run \`glab auth login --hostname ${host}\` or set GITLAB_TOKEN (${scope}).`,
  );
}

// Bearer, not PRIVATE-TOKEN: GitLab accepts both personal access tokens and the
// OAuth token `glab auth login` stores this way, and rejects OAuth in PRIVATE-TOKEN.
export function api(token) {
  const headers = { Authorization: `Bearer ${token}` };

  async function get(path, { all = false } = {}) {
    const results = [];
    const url = new URL(`${config.host}/api/v4${path}`);
    url.searchParams.set('per_page', '100');
    for (let page = '1'; page;) {
      url.searchParams.set('page', page);
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`GitLab ${res.status} on ${path}: ${await res.text()}`);
      const body = await res.json();
      if (!all) return body;
      results.push(...body);
      page = res.headers.get('x-next-page');
    }
    return results;
  }

  async function put(path, body) {
    const res = await fetch(`${config.host}/api/v4${path}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GitLab ${res.status} on PUT ${path}: ${await res.text()}`);
    return res.json();
  }

  return { get, put };
}
