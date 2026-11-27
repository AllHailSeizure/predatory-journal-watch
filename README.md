# Predatory Journal Watch

**Spot sketchy journal links in new posts and comments—then leave a clear warning. Nothing gets removed or reported.**

<!-- SCREENSHOT: A distinguished, locked bot reply under a post that linked a watchlisted journal domain, showing the default warning text and signature. -->

> 📸 Screenshot coming soon: a distinguished, locked bot warning under a community post that linked a watchlisted journal.

Predatory Journal Watch is a [Reddit Devvit](https://developers.reddit.com/docs) app for communities that want a lightweight heads-up when someone shares a link or DOI tied to a publisher on public predatory or hijacked journal lists. The app runs in the background, reads new submissions, and posts a short reply from the app account when it finds a match.

**Legal:** [Terms of Service](https://allhailseizure.github.io/predatory-journal-watch/terms/) · [Privacy Policy](https://allhailseizure.github.io/predatory-journal-watch/privacy/)

Want to suggest a code change? See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## What it does

- **Watches new posts** (body text and link URL) for journal domains and DOIs.
- **Optionally watches new comments** on those posts when comment checking is turned on.
- **Compares links and DOIs** against a backend watchlist built from public sources (see below). DOIs are resolved through doi.org, then Crossref or DataCite, when needed.
- **Replies with a warning** you can customize. The bot does **not** remove posts, report users, or change visibility.
- **Avoids spam:** each post or comment is checked once; each publisher is warned at most once per post (even across several comments).
- **Skips its own comments** so warning threads do not re-trigger the app.

Watchlist data is refreshed daily from:

- [Retraction Watch Hijacked Journal Checker](https://retractionwatch.com/the-retraction-watch-hijacked-journal-checker/)
- [Beall's List](https://beallslist.net/) (publisher, standalone, and hijacked journal pages)

---

## Key features

- Automatic scanning on **every new post** (`onPostSubmit`).
- Optional scanning on **new comments** (`onCommentCreate`).
- Domain matching for URLs in post bodies, link posts, and comments.
- DOI detection (`doi:…`, `doi.org`, `dx.doi.org`, and bare `10.xxxx/…` forms).
- Configurable **warning message** with placeholders for publisher name, list name, and source URL.
- **Allowlist** for domains and publisher names that should never trigger a warning (defaults include MDPI and Frontiers).
- Optional **publisher-name matching** when a DOI’s resolved publisher name matches the watchlist (secondary to domain matching; ISSN is never used).
- Custom **bot signature** appended below the warning (Reddit small-text formatting).
- Warning replies are **distinguished and locked** (on posts, the warning is also **stickied** when the platform allows it).

There are **no mod menu actions, slash commands, or scheduled jobs** in this app—it only reacts to new posts and comments.

---

## Adding the app to your subreddit

1. A moderator with permission to manage apps installs **Predatory Journal Watch** (`predatory-journal-watch`) on the community through Reddit’s Devvit app flow (Developer Portal / community app settings). Published builds are submitted to the Devvit App Store; ask the app operator for the install link if the listing is unlisted.
2. The app needs **moderator** scope so it can post distinguished, locked (and on posts, stickied) replies as the app account.
3. **App-wide (global) settings**—Supabase project URL and API keys—must be filled in by whoever operates the hosted backend. Subreddit moderators normally only see **per-subreddit** settings below.
4. Open the app’s **settings** for your community and adjust behavior before relying on it in production (especially the warning text and allowlist).

---

## Settings (subreddit)

These appear in Devvit app settings for each community that installs the app:

| Setting | What it controls |
| --- | --- |
| **Enable** (`predatoryWatchEnabled`) | Master switch. When off, no warnings are posted. Default: on. |
| **Check comments** (`predatoryWatchCheckComments`) | Also scan new comments. A publisher already warned on that post is not warned again. Default: on. |
| **Warning comment** (`predatoryWatchWarning`) | Template for the reply. Placeholders: `{publisher}`, `{source_list}` (or `{source list}`), `{source_url}`. Leave blank to post nothing. Default warns about possible [predatory publishing](https://en.wikipedia.org/wiki/Predatory_publishing). |
| **Allowlist** (`predatoryWatchAllowlist`) | Domains or publisher names (comma- or newline-separated) that never produce a warning. Default includes `mdpi.com`, `frontiersin.org`, `MDPI`, and `Frontiers`. Clear the field to exempt nobody. |
| **Match publisher names** (`predatoryWatchMatchPublisherName`) | When on, compares a DOI’s resolved publisher name to watchlist names if the landing domain did not match. Default: off. |
| **General — Bot signature** (`botSignature`) | Text appended after the warning (with Reddit small-text formatting). Default: “I am a bot. This action was performed automatically. Contact the moderators if you have questions.” Leave blank for no signature. |

### Example warning template

```text
Note that {publisher} appears on [{source_list}]({source_url}) as a possible predatory journal.
```

The app fills one block per matched publisher, separated by blank lines, then adds your signature.

### Example allowlist

```text
mdpi.com
frontiersin.org
Example Society
```

Tokens with a dot are treated as domains; other tokens are publisher names.

---

## What members see

When a link or DOI matches the watchlist (and is not allowlisted):

1. The app account posts a **reply** under the post or under the comment that contained the link.
2. The reply is **locked** so new replies are discouraged.
3. The reply is **distinguished** as a moderator-style bot notice.
4. On **posts**, the reply is **stickied** when distinction is applied with sticky enabled.

Warnings are ordinary Reddit comments. Moderators can remove or unlock them like any other bot comment.

The app ignores submissions from deleted users, posts and comments with no URLs or DOIs, and content posted by the app account itself.

---

## License

This project is licensed under the **MIT License** (Copyright © 2026 Nate Bosma). See [LICENSE](LICENSE) for the full text.