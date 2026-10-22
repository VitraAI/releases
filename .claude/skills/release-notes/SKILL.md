---
name: release-notes
description: Release SOP step 4. Turn a deployed Universe release's MRs into customer-facing release notes as releases/<id>.json, the single source for the in-app What's New page, the public JSON Feed and the Slack announcement. Validates, previews, then opens a PR; merging it publishes the page and posts to Slack. Use for "write the release notes", "/release-notes <date>", "post the release to Slack", or "update What's New".
argument-hint: <YYYY-MM-DD[.N]> [<mr-link> ...]
---

# /release-notes: customer release notes (SOP step 4)

You write one release's notes as `releases/<id>.json`. That file is the only thing
anyone edits. The build turns it into the What's New page and `feed.json`, and the
GitHub Action posts it to Slack when the PR merges. **Never write a Slack script.**

## Arguments

`$ARGUMENTS` is the release date, optionally followed by the release MRs' links:
`2026-10-22 <mr-link> <mr-link> …` → id `2026.10.22`. `2026-10-22.2` → `2026.10.22.2`
for the day's second release. If the date is missing, ask.

The links are only needed when `/mr-details` didn't run for this release (its
`.work/<id>/mr-details.md` already holds every MR). With no links and no file, fall back
to the MRs labelled `release::<date>`, and if there are none, ask for the links.

## Steps

### 1. Preflight

Run from the root of the releases repo.

```bash
test -d node_modules || npm ci
gh auth status
git status --short && git fetch origin && git switch main && git pull --ff-only
```

- If `gh` isn't logged in, ask the deployer to run `! gh auth login`. They need write
  access to `VitraAI/releases`.
- If the tree is dirty, stop and ask. Never stash or discard someone's changes.
- If `releases/<id>.json` already exists, you're editing it, not creating it. Say so.

### 2. Gather the source material

Use the best source available, in this order:
1. **`.work/<id>/mr-details.md`** from `/mr-details` (step 1), if it exists or is
   already in this session. It's the most complete.
2. Otherwise run `node scripts/collect-mrs.mjs <id> --url <mr-link> …` (or without
   `--url` to use the `release::<date>` label). It needs a GitLab login. Then read the
   merged MR descriptions in `.work/<id>/mrs.json`. Steps 1–2 of the SOP already put good
   descriptions on the MRs.

Leave out any MR whose state is not `merged`, and tell the deployer which ones.
Release notes describe what is live.

### 3. Draft `releases/<id>.json`

Start from the shape of the newest file in `releases/`, and follow
`schema/release.schema.json`. The fields:

- `id`, `date` (YYYY-MM-DD, IST), `schema: 1`, `"$schema": "../schema/release.schema.json"`.
- `title`: the single biggest customer-facing change, ≤ 80 characters, e.g. "Projects replace Folders".
- `summary`: one sentence listing the main changes. It's the Slack notification text
  and the feed summary.
- `tags`: kebab-case area/feature tags.
- `highlights`: up to 3 section ids shown first.
- `sections[]`: one per product area: `id`, `area` (must be an id in
  `config/areas.json`), `kind` (Keep a Changelog: `added` | `changed` | `deprecated` |
  `removed` | `fixed` | `security`), `title`, optional `note`, `items[]`.
- `items[]`: `title` (bold lead-in) + `body`, optional `children[]` (sub-points, one
  level), optional `link` (`{ label, path: "/projects" }`, in-app and org-relative),
  optional per-item `kind`.
- **This repo is PUBLIC.** Everything you write in the file is readable by anyone,
  so the file holds customer-facing content only. There is no internal flag: the
  schema rejects `audience` and `repos`. Leave internal and hidden changes out.

### Writing rules (the house style of every release note since 09-16)

**Audience.** Customers read What's New. The team reads Slack. Write every public line
for a customer.

1. **Benefit first.** Say what someone can now do or what changed for them, not how it
   was built. "Boards update as runs move", not "added socket.io room for runs".
2. **No internals in public text**: no MR numbers, table, column or class names,
   migrations, env vars, workers, queues, library versions or ticket ids. If an
   internal change matters to the team, it belongs in the MR description, not here.
3. **One section per product area**, in this order: highlights, then the rest as they
   matter to customers. **Fixes always come last** in a single `fixes` section
   (`area: "fixes"`, `kind: "fixed"`).
4. **Each item is a bold lead-in, then 1–3 short sentences.** The lead-in is a full
   sentence ending in a period ("Run it on a folder of files."), or a phrase that
   continues into the body. Keep it under ~10 words.
5. **Use `children` for lists inside an item** (tabs, options, sub-features), so Slack
   and the page render a properly indented sub-list. Never cram a list into a sentence
   of 6+ commas, and never nest deeper than one level.
6. **Fixes say what was wrong, then what happens now.** "Burned-in subtitles used the
   wrong language." + "Each export now burns in the language you exported."
7. **Hidden features** (feature-flagged, off for customers, staff-only, "coming soon"
   — today that includes Deals, Performance Marketing and the MCP connector): leave them
   **out completely**. Don't name them anywhere in the file, including the title and
   summary. When one launches, its release announces it.
8. **Formatting inside text**: only `**bold**` for UI labels (button and menu names),
   `` `code` `` for commands the user types, `_italic_` sparingly, and
   `[label](https://…)` links. No HTML, no `<` `>`, no line breaks, no emoji in text
   (areas carry the emoji).
9. **Plain, specific English.** Use exact numbers ("1 hour to 30 days"), spelling as in
   the earlier notes ("colour", "organization"), and no hype words ("revolutionary",
   "seamless", "exciting").
10. **Nothing invented.** Every line must trace to an MR. If you're unsure whether
    something is customer-visible, ask the deployer instead of guessing.

### 4. Check

```bash
npx prettier --write releases/<id>.json
npm run validate -- <id>
npm test
npm run build
node scripts/post-slack.mjs <id> --dry-run > .work/<id>/slack.json
```

Fix every validation error and run the checks again until they're clean. Then show
the deployer a **preview** in chat:

- **What's New (customers):** the title, summary and each public section with its
  items as an indented list, exactly as customers will read it.
- **Slack (team):** the same content in the Slack layout.
- The Block Kit Builder link printed by the dry run, for a pixel check.

Ask: "Anything to change before I open the PR?" Make their edits and re-run step 4.

### 5. Open the PR (only after the deployer says go)

Each command below is an outward-facing action. Get the explicit OK first, then:

```bash
git switch -c release/<id>
git add releases/<id>.json
git commit -m "docs(release): <id> — <title>"
git push -u origin release/<id>
gh pr create --base main --title "Release notes <id> — <title>" --body "<summary + the preview + the MR list>"
```

Only ever stage `releases/<id>.json` (and `config/areas.json` if you added an area).
Never stage `.work/`.

### 6. Hand off

Tell the deployer:
- the PR link;
- **merging the PR publishes**: GitHub Pages redeploys (What's New and `feed.json`
  update within a minute or two), and then the Publish workflow posts to Slack once.
  An edit merged later redeploys the page but does **not** post again;
- to post again on purpose: Actions → Publish → Run workflow → `repost: <id>`.

Never post to Slack from a laptop unless the deployer explicitly asks. If they do, it's
`SLACK_TOKEN=… SLACK_CHANNEL=… node scripts/post-slack.mjs <id>`.
