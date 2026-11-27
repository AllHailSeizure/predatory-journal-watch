# Contributing to Predatory Journal Watch

Thanks for helping improve this [Reddit Devvit](https://developers.reddit.com/docs) Web app. End-user documentation lives in [README.md](README.md). This file is for maintainers and developers.

- **Devvit app:** `predatory-journal-watch` · **Baseline version:** `1.0.0` (new app, never published)
- **Legal (hosted):** [Terms](https://allhailseizure.github.io/predatory-journal-watch/terms/) · [Privacy](https://allhailseizure.github.io/predatory-journal-watch/privacy/)

The module was extracted from `predatory-journal-watch` in [`moderator-toolbox`](https://github.com/AllHailSeizure/Reddit-Devvit) at source commit `649cd2a9e8fece8b3253d373f34ff911e42f931e`. File history was preserved with `git filter-repo`. Cutover steps are in `CUTOVER.md` in [`moderator-toolbox`](https://github.com/AllHailSeizure/moderator-toolbox).

---

## How it works

```
onPostSubmit / onCommentCreate (comments optional)
  │  skip: disabled · already handled · deleted/app author · no URLs or DOIs
  ▼
POST {supabaseUrl}/functions/v1/resolve-doi   { hosts, dois, allowlist, matchPublisherName }
  │  bearer = supabaseFunctionToken (falls back to supabaseServiceKey)
  │  edge function resolves DOIs through doi.org → Crossref / DataCite (14-day cache in doi_resolution)
  │  and matches hosts against predatory_watchlist (refreshed daily by sync-predatory-watchlist)
  ▼
hits → one reply listing every publisher not yet warned on this post
       (post: distinguished + stickied + locked; comment: distinguished + locked)
```

Supabase misconfiguration, an empty watchlist, or a resolve-doi error leaves the item unhandled, so a redelivered trigger can retry it.

### Triggers (`devvit.json`)

| Trigger | Endpoint |
| --- | --- |
| `onPostSubmit` | `/internal/triggers/post-submit` |
| `onCommentCreate` | `/internal/triggers/comment-create` |

There are no menu items, forms, or scheduler tasks in `devvit.json`.

---

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/server/predatory-journal-watch.ts` | Trigger handlers, Redis claims, and the reply |
| `src/server/predatory-journal-decision.ts` | Pure matching rules. The Devvit app and the `resolve-doi` edge function share this file |
| `src/server/*.test.ts` | Decision, watchlist-parser, and resolve-doi unit tests, plus FakeRedditWorld trigger tests (spied `fetch`, no network) |
| `supabase/functions/resolve-doi/` | Edge function: DOI resolution and watchlist matching |
| `supabase/functions/sync-predatory-watchlist/` | Edge function: daily watchlist refresh. `CRON.sql` holds the pg_cron schedule, which is not a migration |
| `supabase/migrations/014`–`016` | `predatory_watchlist`, `doi_resolution`, `function_tokens`. The original numbering is kept to match the shared Supabase project |

### Redis keys (unchanged from moderator-toolbox)

| Key | TTL |
| --- | --- |
| `bot:pjmod:handled:{contentId}` | 7 days |
| `bot:pjmod:pub:{postId}:{publisherKey}` | 180 days |
| `bot:pjmod:log` | capped at 200 entries |

### Settings (`devvit.json`)

**Global:**

- `supabaseUrl`
- `supabaseFunctionToken` (secret): its SHA-256 goes in `public.function_tokens`
- `supabaseServiceKey` (secret): used for bot logs, and as the fallback bearer

**Subreddit:**

- `predatoryWatchEnabled`, `predatoryWatchCheckComments`, `predatoryWatchWarning`, `predatoryWatchAllowlist`, `predatoryWatchMatchPublisherName`, `botSignature`

### HTTP permissions

The app may call `eimdgqymjwfljtapnuyl.supabase.co` (see `devvit.json` `permissions.http.domains`).

### Supabase deployment (manual)

The release workflow publishes only the Devvit app. Deploy Supabase changes by hand:

```sh
npx supabase functions deploy resolve-doi
npx supabase functions deploy sync-predatory-watchlist
# CROSSREF_MAILTO is an optional Supabase secret for Crossref's polite pool
```

The app account comments, so **add `predatory-journal-watch` to `STATIC_BOT_AUTHORS` in moderator-toolbox's report-moderator**. Already done in the slimmed toolbox.

---

## Local development

```sh
npm run check       # lint + typecheck + test + vite build
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm test            # Vitest (no Reddit login required)
npm run build       # Vite build -> dist/server/index.cjs
npm run dev         # npx devvit playtest (requires Devvit login)
```

Node version: see `.node-version`.

### CI

Pull requests and pushes to `master` run **CI** (`.github/workflows/ci.yml`), which runs `npm run check`.

### No-Login Testing (offline virtual Reddit)

`createModTest()` in `src/server/test-harness/` wraps `@devvit/test` with:

- **`FakeRedditWorld`**: subreddits, users (mods, approved, banned, bots), threaded posts and comments, flair, reports, removals and approvals, modmail, wiki pages, mod notes and private messages behind the `reddit.*` API. Every write the app makes is logged (`world.describeActions()`).
- **`ScenarioRunner`**:
  - Simulates Reddit activity (`userPosts`, `userComments`, `report`, `modRemoves`, `userModmails`, `install`, …) and fires whichever triggers `devvit.json` declares.
  - Clicks menus and submits forms as a given user.
  - Advances a fake clock that runs cron tasks and `scheduler.runJob` jobs.
  - Offers a `given` / `when` / `then` scenario DSL.
- **`FakeHttp`**: per-domain `fetch` stubs. An unstubbed call fails the test, so does a host missing from `devvit.json` `permissions.http.domains`, and reddit.com is always blocked.
- **Coverage**: `expectAllEndpointsCovered()` fails if any declared trigger, menu, form or scheduler endpoint has no scenario.

See [`src/server/test-harness/README.md`](src/server/test-harness/README.md) for the API and known gaps, and `src/server/predatory-journal-watch.test.ts` for this app's scenarios.

This repo keeps the harness up to date with `npm run harness:sync`. `npm run harness:check` and the weekly `harness-drift` workflow report drift. Do not edit `src/server/test-harness/` here; change it in [devvit-app-template](https://github.com/AllHailSeizure/devvit-app-template) and sync.

> `createModTest()` wraps plain `test(...)` calls only. For parameterised cases, loop over the cases and call `test(...)` for each one: `test.each` / `test.for` bypass the wrapper, so their tests get no `world` or `runner`.

---

## Required GitHub Secret (`DEVVIT_AUTH_TOKEN`)

The tag release workflow requires a repository (or organization) secret named **`DEVVIT_AUTH_TOKEN`** containing the **full raw contents** of your logged-in `~/.devvit/token` file:

```sh
npx devvit login
npx devvit whoami
gh secret set DEVVIT_AUTH_TOKEN < ~/.devvit/token
```

On Windows PowerShell:

```powershell
npx devvit whoami
Get-Content -LiteralPath (Join-Path $env:USERPROFILE '.devvit/token') -Raw |
  gh secret set DEVVIT_AUTH_TOKEN
```

> **Security & reliability note:** `DEVVIT_AUTH_TOKEN` is an undocumented CLI environment variable holding your personal Reddit OAuth refresh token — not a scoped CI service account. Keep it strictly on the tag release job (never PR workflows), rotate it if compromised, and note that it can expire or require re-login (`devvit login`) if Reddit invalidates sessions.

---

## Versioning & Release Process

### Versioning Rules

- **Strict 3-part SemVer only:** `MAJOR.MINOR.PATCH` (e.g. `1.2.0`). Never use 4-part versions or prerelease suffixes for releases.
- **Lockstep invariant:** Every release keeps four artifacts identical:
  1. `package.json` and `package-lock.json` (`"version": "X.Y.Z"`)
  2. Git tag (`vX.Y.Z`)
  3. GitHub Release (`vX.Y.Z`)
  4. Devvit App Store (`X.Y.Z`)

### Running a Release

Releases are tag-triggered. Pushing a `vX.Y.Z` tag runs **Release Devvit app** (`release.yml`), which publishes **that exact tagged commit** to the Devvit App Store. There is no manual publish button.

Only Nate approves releases. Once Nate has approved a release, Devviteloper (Nate's Devvit project-lead bot) pushes the `vX.Y.Z` tag. Devvit PRs may be merged by Nate or Devviteloper. The release workflow does not enforce that approval; it is a process rule.

1. In a PR, bump the version in `package.json` and `package-lock.json` (`npm version X.Y.Z --no-git-tag-version`), merge it to `master` (Nate or Devviteloper may merge), and wait for **CI** (`ci.yml`) to pass.
2. After Nate has approved the release, Devviteloper tags the merged commit and pushes **only the tag**:

```sh
git checkout master && git pull
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

3. The workflow (a thin caller of the shared [`devvit-release.yml`](https://github.com/AllHailSeizure/.github/blob/master/.github/workflows/devvit-release.yml)) checks out the tag's commit and fails before publishing unless the tag is strict SemVer `vX.Y.Z`, the commit is on `master`, and `package.json` and `package-lock.json` already say `X.Y.Z`. It then runs `npm run check`, authenticates via `DEVVIT_AUTH_TOKEN`, runs `npx --no devvit publish --version X.Y.Z` (with `DEVVIT_ALLOW_SOURCE_UPLOAD=1`), asserts the store reports `X.Y.Z`, and creates GitHub Release `vX.Y.Z`. CI never pushes a commit back.

Releases publish as **unlisted**. To publish publicly, change `visibility: unlisted` to `public` in `release.yml`.

If a tag fails validation, nothing was published: delete the tag (`git push origin :refs/tags/vX.Y.Z`), fix the cause, and tag again. One release runs at a time per repository, so push tags one at a time.

> Note: `devvit publish` submits a version to Reddit's Developer Portal. Installing/upgrading on a subreddit (`devvit install`) and deploying any external Supabase migrations/functions remain separate steps.