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
`2026-10-22 <mr-link> <mr-link> …` → id `26.10.22`. `2026-10-22.2` → `26.10.22.2`
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

- `id` (CalVer `YY.0M.0D`, e.g. `26.10.22`), `date` (YYYY-MM-DD, IST), `schema: 1`, `"$schema": "../schema/release.schema.json"`.
- `title`: the single biggest customer-facing change, ≤ 80 characters, e.g. "Projects replace Folders".
- `summary`: one short sentence naming the main changes, ≤ 160 characters. It's the
  Slack notification text and the feed summary.
- `tags`: kebab-case area/feature tags.
- `highlights`: the feature section ids, in order.
- `sections[]`: `id`, `area` (must be an id in `config/areas.json`), `kind` (Keep a
  Changelog: `added` | `changed` | `deprecated` | `removed` | `fixed` | `security`),
  `title`, optional `note`, `items[]`.
- `items[]`: one line each, as `body` (plain) or `title` (bold, for a UI label or a
  feature name that leads the line), optional `link` (`{ label, path: "/projects" }`,
  in-app and org-relative). No `children`.
- **This repo is PUBLIC.** Everything you write in the file is readable by anyone,
  so the file holds customer-facing content only. There is no internal flag: the
  schema rejects `audience` and `repos`. Leave internal and hidden changes out.

### Writing rules: short, headline-only notes

People skim a release in ten seconds. A release is **80–200 words**, and `npm run validate` enforces the limits
(`LIMITS` in `scripts/validate.mjs`).

**Audience.** Customers read What's New. The team reads Slack. Write every public line
for a customer.

1. **Pick, don't list.** A release has three kinds of section, in this order:
   - **Up to 3 feature sections**, the changes a customer would notice first. Each
     `title` names the feature ("DeepL for translation memories"), its `note` is a
     one-sentence pitch (≤ 25 words) and it has 1–5 headline items. Put a `link` on an
     item when there's a page to open.
   - **More updates** (`id: "more"`, `area: "improvements"`, `kind: "changed"`): up to
     5 headlines for the next most useful changes, each naming its galaxy where that
     helps ("Content Research: drag ideas between stages").
   - **Fixes** (`id: "fixes"`, `area: "fixes"`, `kind: "fixed"`): up to 5 headlines,
     always last.
   Everything else is left out. The MR descriptions keep the full detail.
2. **Each item is one line, ≤ 15 words.** A headline, not a paragraph: what someone
   can now do. "Use your own DeepL Free or Pro key", not how it works or edge cases.
   No sub-lists. If a point needs a second sentence, it's two items or it's cut.
3. **Benefit first.** "Boards update as runs move", not "added socket.io room for runs".
4. **Fixes say what works now**, in one line: "Lists no longer ignore clicks while
   refreshing", "Subtitles burn in the language you exported".
5. **A small release is a small note.** A release with one fix is a single Fixes item.
   Don't pad it into a feature section.
6. **No internals in public text**: no MR numbers, table, column or class names,
   migrations, env vars, workers, queues, library versions or ticket ids.
7. **Hidden features** (feature-flagged, off for customers, staff-only, "coming soon"
   — today that includes Deals, Performance Marketing and the MCP connector): leave them
   **out completely**. Don't name them anywhere in the file, including the title and
   summary. When one launches, its release announces it.
8. **Formatting inside text**: only `**bold**` for UI labels (button and menu names),
   `` `code` `` for commands the user types, `_italic_` sparingly, and
   `[label](https://…)` links. No HTML, no `<` `>`, no line breaks, no emoji in text
   (areas carry the emoji).
9. **Plain, specific English.** Spelling as in the earlier notes ("colour",
   "organization"), and no hype words ("revolutionary", "seamless", "exciting").
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
