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

- **Ids** are calendar versions: `YYYY.MM.DD`, plus `.2` for a second release on the same day.
- **Schema**: [`schema/release.schema.json`](schema/release.schema.json) (JSON Schema 2020-12). Point your editor at it with `"$schema": "../schema/release.schema.json"`.
- **Sections** carry a Keep a Changelog `kind` (`added`, `changed`, `deprecated`, `removed`, `fixed`, `security`) and an `area` from [`config/areas.json`](config/areas.json), which sets the icon and the Slack emoji.
- **Items** are a bold `title` lead-in plus a `body`, with optional `children` (one indented level), `link` and `media`. Text is a small inline Markdown subset: `**bold**`, `_italic_`, `` `code` `` and `[label](https://…)`.
- **This repo is public, so every line in a release file is customer-facing.** Hidden or unlaunched features (feature-flagged, staff-only, "coming soon") and team-only notes are **left out entirely**: no MR numbers, no internal sections. The schema rejects `audience` and `repos` fields. Deploy details belong in the GitLab MR descriptions.
- **`backfill: true`** marks a release written after the fact. It shows on What's New like any other but is never posted to Slack; the flag itself is not published.

The published feed is a standard JSON Feed. Each release is one `item`, with the structured sections in the item's `_universe` extension:

```jsonc
{
  "version": "https://jsonfeed.org/version/1.1",
  "items": [{
    "id": "2026.10.13", "title": "…", "summary": "…",
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
| 1. MR details | `/mr-details 2026-10-22 <mr-link> <mr-link> …` | Reads the given MRs (commits and diffs; or, with no links, every MR labelled `release::2026-10-22`) and writes a paste-ready title and description per MR to `.work/<id>/mr-details.md`. Never edits MRs. |
| 2. Update MRs | (manual) | Paste each title and description into its MR. |
| 3. Merge and deploy | (manual) | As before. |
| 4. Release notes | `/release-notes 2026-10-22` (same session) | Drafts `releases/<id>.json` for customers, validates it, previews the What's New and Slack versions, then opens a PR on your OK. **Merging the PR publishes the page and posts to Slack.** |

To use the skills from another folder, for example in the same session as steps 1–3 in a product repo, copy `.claude/skills/*` into `~/.claude/skills/`.

### One-time setup per deployer

```bash
brew install glab gh
glab auth login --hostname gitlab.com   # read_api is enough
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
| `node scripts/post-slack.mjs <id> --dry-run [--public] [--layout=stacked\|spaced\|compact]` | Print the Slack payload and a Block Kit Builder preview link. `stacked` (default) puts each bold lead-in on its own line with the body under it, a blank line between items and a divider between sections |

## GitHub setup (once)

- **Settings → Pages → Source: GitHub Actions.**
- **Secret** `SLACK_BOT_TOKEN`: a bot token with `chat:write`. Invite the bot to the channel.
- **Variable** `SLACK_CHANNEL`: the channel ID (`C…`).

The Publish workflow posts a release once: after a successful post it pushes the tag `slack/<id>`, and an id that already has the tag is skipped. Editing an existing release only redeploys the page. To post again: Actions → Publish → Run workflow → `repost: <id>`. Backfilled releases (`"backfill": true`) are never posted.
