---
layout: default
title: Privacy Policy
permalink: /privacy/
---

# Privacy Policy — Predatory Journal Watch

**Effective Date:** 2026-11-25

## 1. What the app does

**Predatory Journal Watch** ("the app") runs on Reddit communities through Reddit's Devvit platform. When a post is submitted, or (if enabled) a comment is created, the app scans the text for links and DOIs. If a linked domain or DOI belongs to a publisher on a public predatory or hijacked journal watchlist, the app posts a short, locked, distinguished warning reply. It never removes, reports, or hides content.

## 2. Data the app processes

| Data | Where it goes | Kept for |
| --- | --- | --- |
| Post body, post link, and comment text | Read in memory to find URLs and DOIs. The text itself is not stored. | Not stored |
| Link host names (e.g. `example.com`) and DOIs found in the text, plus the community's allowlist setting | Sent to the app operator's **Supabase** project (edge function `resolve-doi`) | Hosts are not stored. DOI lookups are cached (see §3) |
| Post, comment, and user IDs, and the author's username | Used for de-duplication and the "don't warn on our own comments" check | See §4 |
| The warning comment | Posted publicly on Reddit under the app account | Until removed by moderators |

## 3. Third parties

- **Supabase** (supabase.com) hosts the app's backend: the `resolve-doi` and `sync-predatory-watchlist` edge functions, and the database tables `predatory_watchlist`, `doi_resolution`, and `bot_logs`.
- **DOI resolvers.** To find where a DOI lands, the `resolve-doi` function asks **doi.org** (DOI Foundation) which registration agency handles it. It then queries **Crossref** (api.crossref.org) or **DataCite** (api.datacite.org). Only the DOI string is sent, never Reddit content or usernames. The operator's contact email may be included as Crossref's polite-pool `mailto`. The landing hosts and publisher name for each DOI are cached in `doi_resolution` and reused for 14 days.
- **Watchlist sources.** Once a day, `sync-predatory-watchlist` downloads the public **Retraction Watch Hijacked Journal Checker** (a Google Sheets CSV export) and **Beall's List** (beallslist.net). No Reddit data is sent to these sources.
- **Reddit** runs the app and stores its Redis data and comments.

Data is never sold or used for advertising. It is never sent to AI or LLM services, and it is never used to train models.

## 4. Retention

**Devvit Redis** is scoped to the installing subreddit:

| Key | Contents | Kept for |
| --- | --- | --- |
| `bot:pjmod:handled:{postId or commentId}` | Marker that an item was already checked | 7 days |
| `bot:pjmod:pub:{postId}:{publisher}` | Marker that a publisher was already warned about on a post, so it is never repeated there | 180 days |
| `bot:pjmod:log` | The last 200 warnings: post ID, reply ID, author user ID, item kind, publishers | Until pushed out by newer entries |
| `bot:log:{info, warn, error}` | Operational logs. These can include post, comment, and user IDs, domains, and DOIs | The last 500 entries per level |

**Supabase:**
- When the operator enables remote operational logging, the same log lines written in Redis may also be stored in `bot_logs` until the operator deletes them.
- DOI cache rows (DOI, landing hosts, and publisher name) are reused for 14 days and are not automatically deleted.
- Watchlist rows are refreshed daily.

**Uninstalling:** uninstalling the app removes its Redis data for that subreddit. Supabase rows are not removed automatically. To have them deleted, contact the operator (§6).

## 5. Your choices

Moderators can turn the app off, turn comment scanning off, change the warning text, or add domains and publishers to the allowlist in the app settings. Warning comments are ordinary Reddit comments that moderators can remove.

## 6. Contact

For questions or deletion requests, contact the moderators of the subreddit, or open an issue at [github.com/AllHailSeizure/predatory-journal-watch](https://github.com/AllHailSeizure/predatory-journal-watch/issues).
