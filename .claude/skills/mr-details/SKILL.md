---
name: mr-details
description: Release SOP step 1. Analyze a release's GitLab MRs (commits and code diffs) and write one Markdown file with a paste-ready title and detailed description per MR, covering key changes, env/config, DevOps/infra, migrations, deploy prerequisites, post-deploy steps, dependencies and risks. Use when someone says "generate MR details", "write the release MR descriptions", "/mr-details <date>", or starts a Universe release. Never modifies or creates MRs.
argument-hint: <YYYY-MM-DD[.N]> <mr-link> [<mr-link> ...]
---

# /mr-details: release MR titles and descriptions (SOP step 1)

You write the titles and descriptions for a Universe release's staging → main MRs.
The deployer pastes them into GitLab by hand (step 2), merges and deploys (step 3),
then runs `/release-notes` (step 4), which reads the file you write here.

## The rules (Prompt 1, verbatim intent: do not relax them)

- Analyze **every** MR given, including its **commits and code diffs**.
- Create **a single Markdown file** with a **separate title and detailed description
  for each MR**, based on the **actual changes**.
- Each description must cover, wherever applicable: **key changes**,
  **environment variable/configuration changes**, **DevOps or infrastructure
  requirements**, **database migrations**, **deployment prerequisites**,
  **post-deployment steps**, **dependencies**, and **important notes or risks**.
- Include the **original MR link** in each section.
- **Do not assume or invent details.** Clearly mark anything that needs verification
  with `⚠️ Verify:`.
- **Do not modify or create any MRs.** No `glab mr update`, no API writes, no comments.

## Arguments

`$ARGUMENTS` is the release date, then the release MRs' links (the normal way):

- `2026-10-22 https://gitlab.com/…/universe-3-0-server/-/merge_requests/572 https://gitlab.com/…/universe-3-0-webapp/-/merge_requests/600 …`
  → id `2026.10.22`, exactly these MRs, one per repo in the release.
- `2026-10-22.2 <links…>` → the day's second release, id `2026.10.22.2`.
- `2026-10-22` with no links → falls back to the MRs labelled `release::2026-10-22`.

If no date is given, ask for it; don't guess today's date. If neither links nor a label
match any MR, ask for the links.

## Steps

### 1. Preflight

Run from the root of the releases repo (the folder with `config/projects.json`). If
you're in another folder, find the repo or ask for its path.

```bash
test -d node_modules || npm ci
node -e "process.exit(process.env.GITLAB_TOKEN ? 0 : 1)" || glab auth status
```

If neither a token nor a `glab` login exists, stop and tell the deployer to run
`! glab auth login --hostname gitlab.com` (scope `read_api`) or export `GITLAB_TOKEN`.

### 2. Collect

```bash
node scripts/collect-mrs.mjs <id> --diffs --url <mr-link> --url <mr-link> ...   # links given
node scripts/collect-mrs.mjs <id> --diffs                                         # label fallback
```

This writes `.work/<id>/mrs.json` (title, current description, branches, state,
non-merge commits, changed files and `signals`) and one diff per MR in
`.work/<id>/diffs/`. `.work/` is gitignored, and nothing from it may ever be
committed: this repo is public.

Check the printed list with the deployer before writing anything:
- Is any MR missing? A repo with no MR is fine if nothing changed there. Ask.
- `⚠ opened` or `⚠ targets staging` lines: release MRs normally target `main`. Say so.

### 3. Analyze each MR

For more than one MR, or any diff over ~3,000 lines, launch **one subagent per MR in
parallel**. Give each one the MR's `mrs.json` entry, its diff path, the rules above
and the template below, and have it return only that MR's section. Otherwise do it
inline. Either way, for each MR:

1. Read the commit list first to get the story, then read the diff. Don't describe
   anything from commit titles alone that the diff doesn't show.
2. Go through `signals`. Each non-empty list must end up in the description:
   - `migrations`: list each migration file and what it does. Say whether it is
     destructive or irreversible, and whether it needs a backup.
   - `env`: every added, removed or renamed variable, whether it's required or
     optional, its default, and where it's read.
   - `infra`: CI, Dockerfile, compose and script changes, and what a deployer must do.
   - `dependencies`: added, removed or major-bumped packages.
3. Grep the diff for anything `signals` can miss: `process.env.`, `ConfigService`,
   new queue, worker or Conductor task names, feature flags, cron schedules, new
   external hosts, and RBAC or permission catalog changes.
4. Note cross-repo links: one MR needing another deployed first (server ↔ webapp ↔
   conductor-workers ↔ vitra-tm). Use the MR numbers from `mrs.json`.
5. Anything you infer rather than see must carry `⚠️ Verify:` and say what to check.

### 4. Write `.work/<id>/mr-details.md`

Use exactly this structure. It matches the earlier release files, so reviewers know it.

````markdown
# Release <YYYY-MM-DD> — MR titles and descriptions

All MRs are release MRs from `staging` to `main`. Each section below has its own title and description, ready to paste.

| Repo | MR | Commits (non-merge) |
| --- | --- | --- |
| universe-3-0-server | [!533](<mr url>) | 12 |

---

## 1. <repo> — !<iid>

MR: <mr url>

### Title

```
chore(release): <YYYY-MM-DD> — <3–6 biggest changes, comma-separated>
```

### Description

```markdown
## Summary
<2–4 sentences: what this release of the repo ships and why it matters.>

## What's included
### <Feature or area>
- <change, concrete: what it does, which module>

### Fixes
- <bug → what was wrong, what changed>

## ⚠️ Breaking changes
- <or "None.">

## Deploy notes
### Migrations (<n> new, <m> edited)
- `<file>`: <what it does>. <Backup? reversible?>   ← or "None."

### Environment
| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
← or "No environment changes."

### DevOps / infrastructure
- <CI, Docker, compose, runners, new services, or "None.">

### Prerequisites (before deploy)
- <…or "None.">

### Post-deploy steps
- <Conductor re-register, cron, cache purge, credential sync, backfill script… or "None.">

### Dependencies
- <packages added/removed/major bumps, or "None.">

## Cross-repo
- **<repo> !<iid>**: <how they depend on each other and the deploy order>

## Risks and notes
- <risk, mitigation>
- ⚠️ Verify: <anything uncertain>

## Testing
- <tests added/changed, and what was checked by hand>
```
````

Formatting rules:
- Title: Conventional Commit, `chore(release): <date> — …`, under 100 characters.
- Every heading under **Deploy notes** is always present. Write "None." rather than
  dropping it, so a reviewer can see each one was checked.
- Both fences open and close cleanly so the text pastes into GitLab as-is. Nest the
  ```` ```markdown ```` block inside the outer document correctly.
- Use repo-relative paths and `code` for identifiers. Don't paste secrets, tokens,
  hostnames from `.env` files or customer data from the diff.
- Write plainly in British-neutral English, with no marketing tone. This audience is
  engineers and the deployer.

### 5. Hand off

Tell the deployer:
- the file path (`.work/<id>/mr-details.md`) and a 1-line summary per MR;
- every `⚠️ Verify:` item, as a short list;
- the next step: paste each Title and Description into its MR (step 2), then merge and
  deploy (step 3). After that, `/release-notes <date>` writes the customer release notes
  from this file.

Do not edit any MR, even if asked in passing. Point back to step 2.
