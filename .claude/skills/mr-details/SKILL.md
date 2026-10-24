---
name: mr-details
description: Release SOP step 1. Analyze a release's GitLab MRs (commits and code diffs) and write one Markdown file with a title and detailed description per MR, covering key changes, env/config, DevOps/infra, migrations, deploy prerequisites, post-deploy steps, dependencies and risks; then SOP step 2: set those titles and descriptions on the MRs, after backing up the originals. Use when someone says "generate MR details", "write the release MR descriptions", "/mr-details <date>", or starts a Universe release. Never creates, merges or comments on MRs; it only sets their title and description.
argument-hint: <YYYY-MM-DD[.N]> <mr-link> [<mr-link> ...]
---

# /mr-details: release MR titles and descriptions (SOP steps 1–2)

You write the titles and descriptions for a Universe release's staging → main MRs
(step 1) and set them on the MRs with `scripts/update-mrs.mjs` (step 2). The deployer
merges and deploys (step 3), then runs `/release-notes` (step 4), which reads the file
you write here.

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
- **Write to an MR's title and description only, and only through
  `scripts/update-mrs.mjs`** (step 5 below). It backs up the originals first. Never create,
  merge, close or comment on an MR, change its labels, assignees or branches, or write to
  GitLab any other way (`glab mr update`, `glab api`, hand-made requests).
  (Changed on 2026-10-24 at the deployer's request: step 2 used to be pasted by hand.)

## Arguments

`$ARGUMENTS` is the release date, then the release MRs' links (the normal way):

- `2026-10-22 https://gitlab.com/…/universe-3-0-server/-/merge_requests/572 https://gitlab.com/…/universe-3-0-webapp/-/merge_requests/600 …`
  → id `26.10.22`, exactly these MRs, one per repo in the release.
- `2026-10-22.2 <links…>` → the day's second release, id `26.10.22.2`.
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
`! brew install glab` if needed, then `! glab auth login --hostname gitlab.com`, or to
add `export GITLAB_TOKEN=…` to their shell profile. Step 5 writes to the MRs, so the
token needs scope `api`; `read_api` only covers steps 2–4.

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

All MRs are release MRs from `staging` to `main`. Each section below has its own title and description; `scripts/update-mrs.mjs` sets them on the MRs.

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
- Both fences open and close cleanly, so `update-mrs.mjs` can parse each section and
  GitLab renders it as-is. Keep the headings exactly as shown; the script reads them. Nest the
  ```` ```markdown ```` block inside the outer document correctly.
- Use repo-relative paths and `code` for identifiers. Don't paste secrets, tokens,
  hostnames from `.env` files or customer data from the diff.
- Write plainly in British-neutral English, with no marketing tone. This audience is
  engineers and the deployer.

### 5. Update the MRs (SOP step 2)

```bash
node scripts/update-mrs.mjs <id> --dry-run   # parse and check every section; no writes
node scripts/update-mrs.mjs <id>             # set each MR's title and description
```

- Run the dry run first. It checks every section before anything is written: the
  heading, the MR link, a `chore(release)` title under 100 characters, a `## Summary`
  and no nested fence. Fix the file and run it again until it passes.
- The real run saves each MR's live title and description to
  `.work/<id>/previous-descriptions.json` before its first write. An MR that is already in
  that file keeps its first saved copy, so running it again never loses the author's text.
  It skips MRs that already match, reads each MR back after writing, and stops on any
  mismatch.
- Only the MRs in `mr-details.md` are touched. To re-run after editing one section, run
  the same command; the unchanged MRs are skipped.
- On a 401 or 403, the token lacks `api` scope: stop and tell the deployer (see Preflight).
- If the deployer asks to restore the originals, set them back from
  `previous-descriptions.json` with the same `PUT` and say which MRs changed.

### 6. Hand off

Tell the deployer:
- the file path (`.work/<id>/mr-details.md`) and a 1-line summary per MR;
- which MRs `update-mrs.mjs` updated or skipped, and the backup path;
- every `⚠️ Verify:` item, as a short list (they are now in the MR descriptions too);
- the next step: merge and deploy (step 3). After that, `/release-notes <date>` writes
  the customer release notes from this file.
