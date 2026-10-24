# Universe release notes

One JSON file per release is the single source for every place release notes appear:

| Surface | How it gets the notes |
| --- | --- |
| In-app **What's new** page (webapp `/[slug]/whats-new`) | reads `feed.json` from GitHub Pages |
| Public feed for anything else (email, landing page, feed readers) | `https://vitraai.github.io/releases/feed.json` ([JSON Feed 1.1](https://jsonfeed.org/version/1.1)) |
| Human-readable page | `https://vitraai.github.io/releases/` |
| Slack announcement | posted by the Publish workflow when a new release merges |

```
releases/<id>.json   ← you (or /release-notes) edit this, nothing else
        │  npm run build   (validate → JSON Feed)
        ▼
dist/feed.json, dist/<id>.json, dist/index.html   → GitHub Pages
        │  Publish workflow, after the deploy
        ▼
Slack #channel (once per release, tag slack/<id>)
```

## Format

- **Ids** are calendar versions (CalVer) `YY.0M.0D`: the release day, e.g. `26.10.24`, plus `.2` for a second release on the same day. They show as `v26.10.24`. GitLab labels keep the full date (`release::2026-10-24`).
- **Schema**: [`schema/release.schema.json`](schema/release.schema.json) (JSON Schema 2020-12). Point your editor at it with `"$schema": "../schema/release.schema.json"`.
- **Sections** carry a Keep a Changelog `kind` (`added`, `changed`, `deprecated`, `removed`, `fixed`, `security`) and an `area` from [`config/areas.json`](config/areas.json), which sets the icon and the Slack emoji.
- **Short by design**, so a release reads in seconds: up to 3 feature sections (a one-sentence `note` plus headline items), then **More updates** (area `improvements`) and **Fixes**, at most 5 items each. Every item is one line of ≤ 15 words, and a release is ≤ 220 words. `npm run validate` enforces this (`LIMITS` in `scripts/validate.mjs`); the full detail lives in the MR descriptions.
- **Items** are one line: a `body`, or a bold `title`, with optional `link` and `media`. The schema still accepts `children` for older consumers, but the validator rejects them. Text is a small inline Markdown subset: `**bold**`, `_italic_`, `` `code` `` and `[label](https://…)`.
- **This repo is public, so every line in a release file is customer-facing.** Hidden or unlaunched features (feature-flagged, staff-only, "coming soon") and team-only notes are **left out entirely**: no MR numbers, no internal sections. The schema rejects `audience` and `repos` fields. Deploy details belong in the GitLab MR descriptions.
- **`backfill: true`** marks a release written after the fact. It shows on What's New like any other but is never posted to Slack; the flag itself is not published.

The published feed is a standard JSON Feed. Each release is one `item`, with the structured sections in the item's `_universe` extension:

```jsonc
{
  "version": "https://jsonfeed.org/version/1.1",
  "items": [{
    "id": "26.10.13", "title": "…", "summary": "…",
    "content_html": "…", "date_published": "2026-10-13T12:00:00+05:30",
    "_universe": { "schema": 1, "date": "2026-10-13", "highlights": [], "sections": [ … ] }
  }],
  "_universe": { "schema": 1, "areas": [{ "id": "projects", "label": "Projects", "icon": "folder-kanban" }] }
}
```

## Release SOP: the two Claude Code skills

Open Claude Code in a clone of this repo. The skills live in `.claude/skills/` and are picked up automatically.

| SOP step | Command | What it does |
| --- | --- | --- |
| 1. MR details | `/mr-details 2026-10-22 <mr-link> <mr-link> …` | Reads the given MRs (commits and diffs; or, with no links, every MR labelled `release::2026-10-22`) and writes a title and description per MR to `.work/<id>/mr-details.md`, then runs step 2. |
| 2. Update MRs | run by `/mr-details` (`npm run update-mrs -- <id>`) | Sets each MR's title and description from `mr-details.md`. It backs up the originals to `.work/<id>/previous-descriptions.json` first, skips MRs that already match and reads each one back. It never creates, merges or comments on MRs. |
| 3. Merge and deploy | (manual) | As before. |
| 4. Release notes | `/release-notes 2026-10-22` (same session) | Drafts `releases/<id>.json` for customers, validates it, previews the What's New and Slack versions, then opens a PR on your OK. **Merging the PR publishes the page and posts to Slack.** |

To use the skills from another folder, for example in the same session as steps 1–3 in a product repo, copy `.claude/skills/*` into `~/.claude/skills/`.

### One-time setup per deployer

```bash
brew install glab gh
glab auth login --hostname gitlab.com   # api scope: step 2 writes MR titles and descriptions
gh auth login                            # needs write access to VitraAI/releases
npm ci
```

No Slack token is needed on laptops. The workflow posts with the repo secret.

`.work/` is gitignored. It holds MR descriptions and diffs, which include infra, env and migration details. **This repo is public: never commit anything from `.work/`.**

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run validate [-- <id> …]` | Schema plus cross-checks: file name = id, date matches, known areas, unique sections, highlights exist, parseable text, at least one public section |
| `npm test` | Unit tests, including the checks that no repo-only field leaks into the build |
| `npm run build` | `dist/` for Pages; stops on any invalid file |
| `npm run check` | All of the above plus Prettier |
| `node scripts/collect-mrs.mjs <id> [--diffs] [--url <mr> …]` | Pull a release's MRs from GitLab into `.work/<id>/` |
| `node scripts/update-mrs.mjs <id> [--dry-run]` | Set each MR's title and description from `.work/<id>/mr-details.md`, backing up the originals first. `--dry-run` only parses and checks the file |
| `node scripts/post-slack.mjs <id> --dry-run [--public] [--layout=stacked\|spaced\|compact]` | Print the Slack payload and a Block Kit Builder preview link. `stacked` (default) puts each bold lead-in on its own line with the body under it, a blank line between items and a divider between sections |

## GitHub setup (once)

- **Settings → Pages → Source: GitHub Actions.**
- **Secret** `SLACK_BOT_TOKEN`: a bot token with `chat:write`. Invite the bot to the channel.
- **Variable** `SLACK_CHANNEL`: the channel ID (`C…`).

The Publish workflow posts a release once: after a successful post it pushes the tag `slack/<id>`, and an id that already has the tag is skipped. Editing an existing release only redeploys the page. To post again: Actions → Publish → Run workflow → `repost: <id>`. Backfilled releases (`"backfill": true`) are never posted.
