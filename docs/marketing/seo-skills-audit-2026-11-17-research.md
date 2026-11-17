# DeclutrMail search-presence and keyword research

Collected 2026-11-17. Read-only. No accounts, sign-ins, posts or contact.

## Method and limits (read first)

- **WebSearch** is the Claude Code web-search tool (US results). It is **not Google**, and its "Links" list is the only rank signal it gives. "Rank" below is the position in that list, not a Google SERP position. Answer engines (Perplexity, ChatGPT search) use their own indexes, so treat these rows as a proxy.
- WebSearch has two modes. **standard** was run for every query. **extended** (a fresher, deeper index) was run only for the brand queries and five non-brand queries where DeclutrMail has a dedicated page. The two modes returned very different result sets (see "Standard vs extended" below).
- Rows list the first ~8 links in the order returned, including same-domain repeats, so domain dominance stays visible.
- **curl** was used for Google autocomplete (Task B), the HN Algolia API, and status checks against Reddit, Product Hunt, AlternativeTo and G2 (all four returned HTTP 403 to curl, so direct checks there are UNVERIFIED).
- No search-volume data was available, and none is implied.

## Headline findings (2026-11-17)

1. **declutrmail.com did not appear in any standard-mode result** for the 12 non-brand queries, nor for the brand queries "declutrmail", "declutrmail review", `"declutrmail.com"` or `site:declutrmail.com`. In standard mode the engine treated "declutrmail" as a typo for **DeclutterMyMail** (an unrelated IMAP cleanup tool on AlternativeTo).
2. **In extended mode, the brand query "declutrmail" returned declutrmail.com for all 10 results** (/faq, /terms, /privacy, /how-it-works, /contact, /vs/clean-email, /, /compare, /beta, /vs/gmail), and "declutrmail review" returned six declutrmail.com /vs/ pages at positions 3-8 (positions 1-2 were Trustpilot pages for Decluttr.com, a different company). So the site is indexed in the fresher index, but only reachable by its exact name.
3. **For the five non-brand queries re-run in extended mode** ("best gmail cleanup tool", "clean email alternative", "unroll.me alternative", "delete all emails from one sender gmail", "gmail sort by sender"), declutrmail.com was **not present**.
4. **clean.email dominates** (present in 12 of 14 standard query lists; often multiple language variants). Next most frequent: leavemealone.com, mailmeteor.com, alternativeto.net, mailstrom.co, blog.superhuman.com, thebusinessdive.com, againstdata.com, cleanmymac.com/macpaw.com.
5. **No third-party (independent) page mentioning DeclutrMail was found.** The only non-declutrmail.com pages found for the name were the project's own public GitHub repository and its issues/PRs (see A2), which answer engines can and do summarise.

### Standard vs extended (same query, 2026-11-17)

| Query                                   | standard: declutrmail.com?                                                      | extended: declutrmail.com?                                                                             | Date       | Tool      |
| --------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| declutrmail                             | not present (results = DeclutterMyMail, Fastmail, Clean Email blog)             | positions 1-10 (all first-party)                                                                       | 2026-11-17 | WebSearch |
| declutrmail review                      | not present                                                                     | positions 3-8 (/vs/gmail, /vs/trimbox, /vs/clean-email, /vs/sanebox, /vs/gmail-filters, /vs/unroll-me) | 2026-11-17 | WebSearch |
| best gmail cleanup tool                 | not present                                                                     | not present                                                                                            | 2026-11-17 | WebSearch |
| clean email alternative                 | not present                                                                     | not present                                                                                            | 2026-11-17 | WebSearch |
| unroll.me alternative                   | not present                                                                     | not present                                                                                            | 2026-11-17 | WebSearch |
| delete all emails from one sender gmail | not present                                                                     | not present                                                                                            | 2026-11-17 | WebSearch |
| gmail sort by sender                    | not present                                                                     | not present                                                                                            | 2026-11-17 | WebSearch |
| "declutrmail.com"                       | not present                                                                     | not run                                                                                                | 2026-11-17 | WebSearch |
| site:declutrmail.com                    | not present (operator apparently ignored; unrelated "declutter" pages returned) | not run                                                                                                | 2026-11-17 | WebSearch |

Indexability spot-check (curl, 2026-11-17): https://declutrmail.com/ returns 200; robots.txt allows `/` and disallows only app routes (/senders, /triage, /settings, etc.); sitemap.xml lists 47 `<loc>` URLs; no `<meta name="robots">` tag and no `X-Robots-Tag` header on /, /vs/clean-email, /how-to/clean-gmail-by-sender. Nothing found that blocks indexing.

---

## A. Search presence

### A.1 "best gmail cleanup tool"

| Rank | Domain                  | URL                                                                         | Date       | Tool                 |
| ---- | ----------------------- | --------------------------------------------------------------------------- | ---------- | -------------------- |
| 1    | clean.email             | https://clean.email/clean-gmail-inbox/best-gmail-cleanup-tools              | 2026-11-17 | WebSearch (standard) |
| 2    | clean.email             | https://clean.email/best-gmail-cleanup-tools                                | 2026-11-17 | WebSearch (standard) |
| 3    | notion.com              | https://www.notion.com/blog/gmail-cleaner-app                               | 2026-11-17 | WebSearch (standard) |
| 4    | clean.email             | https://clean.email/de/clean-gmail-inbox/best-gmail-cleanup-tools           | 2026-11-17 | WebSearch (standard) |
| 5    | clean.email             | https://clean.email/ja/clean-gmail-inbox/best-gmail-cleanup-tools           | 2026-11-17 | WebSearch (standard) |
| 6    | appsource.microsoft.com | https://appsource.microsoft.com/en-us/product/saas/bitrecover.gmail-cleaner | 2026-11-17 | WebSearch (standard) |
| 7    | blog.superhuman.com     | https://blog.superhuman.com/app-to-clean-up-email/                          | 2026-11-17 | WebSearch (standard) |
| 8    | cleanmymac.com          | https://cleanmymac.com/blog/best-email-cleaner-app                          | 2026-11-17 | WebSearch (standard) |
| 1    | clean.email             | https://clean.email/clean-gmail-inbox/best-gmail-cleanup-tools              | 2026-11-17 | WebSearch (extended) |
| 2    | clean.email             | https://clean.email/blog/email-management/best-email-cleaner-app            | 2026-11-17 | WebSearch (extended) |
| 3    | inboxpurge.com          | https://www.inboxpurge.com/blog/best-email-cleaner-for-gmail                | 2026-11-17 | WebSearch (extended) |
| 4    | newmail.ai              | https://www.newmail.ai/feeds/blog/gmail-inbox-cleanup-tool                  | 2026-11-17 | WebSearch (extended) |
| 5    | purebox.ai              | https://purebox.ai/guides/best-gmail-cleanup-tools                          | 2026-11-17 | WebSearch (extended) |
| 6    | mailsweeper.co          | https://www.mailsweeper.co/blog/best-gmail-cleanup-tools                    | 2026-11-17 | WebSearch (extended) |
| 7    | inboxzapper.com         | https://www.inboxzapper.com/post/best-email-clean-up-tool                   | 2026-11-17 | WebSearch (extended) |
| 8    | verified.email          | https://verified.email/blog/reviews/best-gmail-cleanup-tools                | 2026-11-17 | WebSearch (extended) |

- Further standard results: clean.email/pt, clean.email/blog, trimbox.io/blog, getmailbird.com, a LinkedIn mirror (SysTools), emailanalytics.com, againstdata.com, listicler.com. Further extended: mailmop.com, gmailytics.com.
- **declutrmail.com:** not present (standard or extended).
- **Products named:** Clean Email, Mailstrom, SaneBox, Unroll.me, CleanMyMac Email Cleanup, Shortwave, Trimbox, BitRecover, SysTools; extended adds InboxPurge, MailMop, Gmailytics, Gmail Manage Subscriptions.

### A.2 "best app to clean up gmail 2026"

| Rank | Domain                | URL                                                                                       | Date       | Tool                 |
| ---- | --------------------- | ----------------------------------------------------------------------------------------- | ---------- | -------------------- |
| 1    | replyless.beehiiv.com | https://replyless.beehiiv.com/p/best-email-cleaner-app-for-gmail-outlook-and-zoho-in-2026 | 2026-11-17 | WebSearch (standard) |
| 2    | leavemealone.com      | https://leavemealone.com/blog/unsubscribe-apps-for-email/amp/                             | 2026-11-17 | WebSearch (standard) |
| 3    | leavemealone.com      | https://leavemealone.com/blog/unsubscribe-apps-for-email/                                 | 2026-11-17 | WebSearch (standard) |
| 4    | thebusinessdive.com   | https://thebusinessdive.com/?p=18836                                                      | 2026-11-17 | WebSearch (standard) |
| 5    | clean.email           | https://clean.email/de/blog/email-management/best-email-cleaner-app                       | 2026-11-17 | WebSearch (standard) |
| 6    | clean.email           | https://clean.email/clean-gmail-inbox/best-gmail-cleanup-tools                            | 2026-11-17 | WebSearch (standard) |
| 7    | thebusinessdive.com   | https://thebusinessdive.com/?p=19255                                                      | 2026-11-17 | WebSearch (standard) |
| 8    | clean.email           | https://clean.email/best-email-app                                                        | 2026-11-17 | WebSearch (standard) |

- Further: clean.email/best-gmail-cleanup-tools, thebusinessdive.com/best-email-apps, cleanmymac.com, notion.com, clean.email/blog, emailanalytics.com, mailstrom.co/articles/best-email-cleanup-tools-2026/, prospeo.io.
- **declutrmail.com:** not present.
- **Products named:** Clean Email, Mailstrom, SaneBox, CleanMyMac, Leave Me Alone, Gmail built-in tools.

### A.3 "how to clean up gmail inbox"

| Rank | Domain          | URL                                                                                   | Date       | Tool                 |
| ---- | --------------- | ------------------------------------------------------------------------------------- | ---------- | -------------------- |
| 1    | clickup.com     | https://clickup.com/blog/how-to-clean-up-your-gmail-inbox/                            | 2026-11-17 | WebSearch (standard) |
| 2    | katheats.com    | https://katheats.com/how-to-clean-up-gmail-inbox                                      | 2026-11-17 | WebSearch (standard) |
| 3    | edisonmail.com  | https://www.edisonmail.com/how-to/clean-up-gmail                                      | 2026-11-17 | WebSearch (standard) |
| 4    | mailmeteor.com  | https://mailmeteor.com/blog/gmail-clean-up                                            | 2026-11-17 | WebSearch (standard) |
| 5    | againstdata.com | https://againstdata.com/blog/get-a-clean-email-today-with-these-5-top-practices       | 2026-11-17 | WebSearch (standard) |
| 6    | clean.email     | https://clean.email/clean-gmail-inbox                                                 | 2026-11-17 | WebSearch (standard) |
| 7    | blocksender.io  | https://blocksender.io/how-to-quickly-clean-up-your-gmail-inbox-and-keep-it-that-way/ | 2026-11-17 | WebSearch (standard) |
| 8    | engagebay.com   | https://www.engagebay.com/blog/gmail-cleanup/                                         | 2026-11-17 | WebSearch (standard) |

- Further: keeping.com, streak.com, smallbusiness.chron.com, cyberguy.com, spikenow.com, emailanalytics.com, portfolink.com.
- **declutrmail.com:** not present.
- **Products named:** Clean Email, SaneBox (otherwise Gmail-native steps: search operators, Manage subscriptions, filters).

### A.4 "delete all emails from one sender gmail"

| Rank | Domain                | URL                                                                                                                       | Date       | Tool                 |
| ---- | --------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------- |
| 1    | mailmeteor.com        | https://mailmeteor.com/blog/delete-all-emails-from-one-sender                                                             | 2026-11-17 | WebSearch (standard) |
| 2    | alibaba.com           | https://www.alibaba.com/product-insights/effective-ways-to-quickly-delete-all-emails-from-a-specific-sender-in-gmail.html | 2026-11-17 | WebSearch (standard) |
| 3    | blocksender.io        | https://blocksender.io/how-to-delete-all-emails-from-one-sender-in-gmail-bulk-and-auto-delete-methods/                    | 2026-11-17 | WebSearch (standard) |
| 4    | fyxer.com             | https://www.fyxer.com/blog/how-to-delete-all-emails-from-one-sender                                                       | 2026-11-17 | WebSearch (standard) |
| 5    | xfanatical.com        | https://xfanatical.com/blog/how-to-delete-all-emails-from-one-sender                                                      | 2026-11-17 | WebSearch (standard) |
| 6    | landing.fyxer.com     | https://landing.fyxer.com/blog/how-to-delete-all-emails-from-one-sender                                                   | 2026-11-17 | WebSearch (standard) |
| 7    | clean.email           | https://clean.email/de/how-to-delete-all-emails/delete-all-emails-from-one-sender                                         | 2026-11-17 | WebSearch (standard) |
| 8    | clean.email           | https://clean.email/ja/how-to-delete-all-emails/delete-all-emails-from-one-sender                                         | 2026-11-17 | WebSearch (standard) |
| 1    | blog.superhuman.com   | https://blog.superhuman.com/how-to-delete-all-emails-on-gmail/                                                            | 2026-11-17 | WebSearch (extended) |
| 2    | fyxer.com             | https://www.fyxer.com/blog/how-to-delete-all-emails-from-one-sender                                                       | 2026-11-17 | WebSearch (extended) |
| 3    | clean.email           | https://clean.email/how-to-delete-all-emails/delete-all-emails-from-one-sender                                            | 2026-11-17 | WebSearch (extended) |
| 4    | timeatlas.com         | https://www.timeatlas.com/delete-gmail-items-in-bulk/                                                                     | 2026-11-17 | WebSearch (extended) |
| 5    | xrilion.quora.com     | https://xrilion.quora.com/How-to-Delete-All-Emails-from-One-Sender-on-Gmail                                               | 2026-11-17 | WebSearch (extended) |
| 6    | zapier.com            | https://zapier.com/blog/how-to-mass-delete-emails-gmail/                                                                  | 2026-11-17 | WebSearch (extended) |
| 7    | teamdynamix.umich.edu | https://teamdynamix.umich.edu/TDClient/30/Portal/KB/Article/11495/Google-How-Do-I-Bulk-Mass-Delete-Emails-in-Gmail        | 2026-11-17 | WebSearch (extended) |

- Further standard: makeuseof.com, techpp.com, clean.email (en), geekchamp.com, technorms.com, clean.email/fr, iguru.gr, a WikiHow mirror. Extended positions 8-9 were spam-like pages on nvidia.com / uw.edu subdomains.
- **declutrmail.com:** not present (standard or extended). DeclutrMail's matching page is /how-to/bulk-delete-emails-from-one-sender.
- **Products named:** Block Sender, Clean Email (Fyxer, Superhuman, Zapier appear as publishers, not as cleanup tools).

### A.5 "gmail storage full what to delete"

| Rank | Domain            | URL                                                                                              | Date       | Tool                 |
| ---- | ----------------- | ------------------------------------------------------------------------------------------------ | ---------- | -------------------- |
| 1    | 91mobiles.com     | https://www.91mobiles.com/hub/clear-google-account-gmail-storage/                                | 2026-11-17 | WebSearch (standard) |
| 2    | techpp.com        | https://techpp.com/2013/03/11/gmail-is-full-what-to-do/                                          | 2026-11-17 | WebSearch (standard) |
| 3    | clean.email       | https://clean.email/clean-gmail-inbox/what-happens-to-emails-when-gmail-is-full                  | 2026-11-17 | WebSearch (standard) |
| 4    | mailmeteor.com    | https://mailmeteor.com/blog/gmail-storage-full                                                   | 2026-11-17 | WebSearch (standard) |
| 5    | blog.mailstrom.co | https://blog.mailstrom.co/full-gmail-storage-heres-what-you-can-do-to-free-space                 | 2026-11-17 | WebSearch (standard) |
| 6    | slashgear.com     | https://www.slashgear.com/1302772/gmail-storage-low-what-to-do/                                  | 2026-11-17 | WebSearch (standard) |
| 7    | getmailbird.com   | https://www.getmailbird.com/gmail-storage-full-how-to-free-up-space-when-you-hit-the-15gb-limit/ | 2026-11-17 | WebSearch (standard) |
| 8    | mailstrom.co      | https://mailstrom.co/articles/full-gmail-storage-heres-what-you-can-do-to-free-space/            | 2026-11-17 | WebSearch (standard) |

- Further: webrankinfo.com (x2), techpp.com (2024), lilachbullock.com (x2), macpaw.com, getinboxzero.com, fox26houston.com, multcloud.com, clean.email (x2), geekinstructor.com.
- **declutrmail.com:** not present. DeclutrMail's matching page is /how-to/gmail-storage-full.
- **Products named:** Clean Email, Mailstrom, MacPaw/CleanMyMac, Inbox Zero, Google One Storage Manager.

### A.6 "unroll.me alternative"

| Rank | Domain                 | URL                                                                 | Date       | Tool                 |
| ---- | ---------------------- | ------------------------------------------------------------------- | ---------- | -------------------- |
| 1    | clean.email            | https://clean.email/best-unroll-me-alternative                      | 2026-11-17 | WebSearch (standard) |
| 2    | alternativeto.net      | https://alternativeto.net/software/unroll-me/?p=3                   | 2026-11-17 | WebSearch (standard) |
| 3    | alternativeto.net      | https://alternativeto.net/software/unroll-me/?p=2                   | 2026-11-17 | WebSearch (standard) |
| 4    | alternativeto.net      | https://alternativeto.net/software/unroll-me/?p=4                   | 2026-11-17 | WebSearch (standard) |
| 5    | getapp.co.uk           | https://www.getapp.co.uk/alternatives/2047431/unroll-me             | 2026-11-17 | WebSearch (standard) |
| 6    | alternativeto.net      | https://alternativeto.net/software/unroll-me                        | 2026-11-17 | WebSearch (standard) |
| 7    | softwareadvice.com.au  | https://www.softwareadvice.com.au/alternatives/238339/unroll-me     | 2026-11-17 | WebSearch (standard) |
| 8    | getapp.ca              | https://www.getapp.ca/alternatives/2047431/unroll-me                | 2026-11-17 | WebSearch (standard) |
| 1    | leavemealone.com       | https://leavemealone.com/unroll-me-alternative/                     | 2026-11-17 | WebSearch (extended) |
| 2    | mailstrom.co           | https://mailstrom.co/articles/best-unroll-me-alternatives-2026/     | 2026-11-17 | WebSearch (extended) |
| 3    | clean.email            | https://clean.email/best-unroll-me-alternative                      | 2026-11-17 | WebSearch (extended) |
| 4    | inboxpurge.com         | https://www.inboxpurge.com/blog/best-alternative-to-unroll-me       | 2026-11-17 | WebSearch (extended) |
| 5    | toolradar.com          | https://toolradar.com/alternatives/unroll-me                        | 2026-11-17 | WebSearch (extended) |
| 6    | email-unsubscriber.com | https://email-unsubscriber.com/blog/unroll-me-alternatives          | 2026-11-17 | WebSearch (extended) |
| 7    | miniletter.app         | https://www.miniletter.app/blog/best-unroll-me-alternatives-in-2026 | 2026-11-17 | WebSearch (extended) |
| 8    | alternativeto.net      | https://www.alternativeto.net/software/unroll-me/                   | 2026-11-17 | WebSearch (extended) |

- Further standard: getapp.com.au, leavemealone.com/unroll-me-alternative, capterra.co.nz, leavemealone.com blog (x3), capterra.ie, thebusinessdive.com, toolradar.com, peerpush.com.
- **declutrmail.com:** not present (standard or extended). DeclutrMail's matching pages are /alternatives/unroll-me and /vs/unroll-me.
- **Products named:** Leave Me Alone, Clean Email, SaneBox, lockrMail, Gmail Unsubscribe, Paperweight; extended adds Mailstrom, InboxPurge, Cleanfox, Gmail Manage subscriptions.

### A.7 "clean email alternative"

| Rank | Domain            | URL                                                               | Date       | Tool                 |
| ---- | ----------------- | ----------------------------------------------------------------- | ---------- | -------------------- |
| 1    | canarymail.io     | https://canarymail.io/blog/?p=5085                                | 2026-11-17 | WebSearch (standard) |
| 2    | canarymail.io     | https://canarymail.io/blog/clean-email-alternatives               | 2026-11-17 | WebSearch (standard) |
| 3    | dhruvirzala.com   | https://dhruvirzala.com/clean-email-alternative/                  | 2026-11-17 | WebSearch (standard) |
| 4    | alternativeto.net | https://alternativeto.net/software/cleanemail/?p=4                | 2026-11-17 | WebSearch (standard) |
| 5    | dhruvirzala.com   | https://dhruvirzala.com/?p=4889                                   | 2026-11-17 | WebSearch (standard) |
| 6    | leavemealone.com  | https://leavemealone.com/blog/best-clean-email-alternatives-2026/ | 2026-11-17 | WebSearch (standard) |
| 7    | alternativeto.net | https://alternativeto.net/software/cleanemail/                    | 2026-11-17 | WebSearch (standard) |
| 8    | againstdata.com   | https://againstdata.com/blog/clean-email-alternatives             | 2026-11-17 | WebSearch (standard) |
| 1    | g2.com            | https://www.g2.com/products/clean-email/competitors/alternatives  | 2026-11-17 | WebSearch (extended) |
| 2    | canarymail.io     | https://canarymail.io/blog/clean-email-alternatives               | 2026-11-17 | WebSearch (extended) |
| 3    | mailstrom.co      | https://mailstrom.co/articles/best-clean-email-alternatives-2026/ | 2026-11-17 | WebSearch (extended) |
| 4    | producthunt.com   | https://www.producthunt.com/products/clean-email/alternatives     | 2026-11-17 | WebSearch (extended) |
| 5    | leavemealone.com  | https://leavemealone.com/blog/best-clean-email-alternatives-2026/ | 2026-11-17 | WebSearch (extended) |
| 6    | dhruvirzala.com   | https://dhruvirzala.com/clean-email-alternative/                  | 2026-11-17 | WebSearch (extended) |
| 7    | mailover.ai       | https://mailover.ai/blog/best-clean-email-alternatives.html       | 2026-11-17 | WebSearch (extended) |
| 8    | aiemaily.com      | https://aiemaily.com/blog/best-clean-email-alternatives-2026      | 2026-11-17 | WebSearch (extended) |

- Further standard: mailstrom.co, clean.email (x2), maestrolabs.com, g2.com, againstdata.com (Cleanfox), slashdot.org, toolradar.com, **mailledger.pages.dev/vs/clean-email** (another small vendor's /vs/ page), selfhostyourself.com, thebusinessdive.com, alternative.me, mailbutler.io. Further extended: mailmop.com.
- **declutrmail.com:** not present (standard or extended). DeclutrMail's matching pages are /alternatives/clean-email and /vs/clean-email.
- **Products named:** SaneBox, Mailstrom, InboxPurge, MailMop, Unroll.Me, Leave Me Alone, AgainstData, MailLedger; extended adds Trimbox, Cleanfox, Superhuman, Spark, Shortwave, Notion Mail.

### A.8 "sanebox alternative"

| Rank | Domain              | URL                                                               | Date       | Tool                 |
| ---- | ------------------- | ----------------------------------------------------------------- | ---------- | -------------------- |
| 1    | jotform.com         | https://www.jotform.com/ai/agents/sanebox-alternatives/           | 2026-11-17 | WebSearch (standard) |
| 2    | lindy.ai            | https://www.lindy.ai/blog/sanebox-alternatives                    | 2026-11-17 | WebSearch (standard) |
| 3    | blog.superhuman.com | https://blog.superhuman.com/sanebox-alternatives/                 | 2026-11-17 | WebSearch (standard) |
| 4    | mailbutler.io       | https://www.mailbutler.io/blog/email/sanebox-alternatives/        | 2026-11-17 | WebSearch (standard) |
| 5    | alternativeto.net   | https://alternativeto.net/software/sanebox/?p=3                   | 2026-11-17 | WebSearch (standard) |
| 6    | leavemealone.com    | https://leavemealone.com/blog/best-sanebox-alternatives-2026/amp/ | 2026-11-17 | WebSearch (standard) |
| 7    | alternativeto.net   | https://alternativeto.net/software/sanebox/?p=2                   | 2026-11-17 | WebSearch (standard) |
| 8    | leavemealone.com    | https://leavemealone.com/blog/best-sanebox-alternatives-2026/     | 2026-11-17 | WebSearch (standard) |

- Further: maestrolabs.com, getinboxzero.com, many Capterra/GetApp/Software Advice country sites, fitgap.com, hackceleration.com, g2.com, alkmist.com, aichief.com, stork.ai, aiapps.com, seofai.com, toolradar.com, aiproductivity.ai.
- **declutrmail.com:** not present. DeclutrMail's matching pages are /alternatives/sanebox and /vs/sanebox.
- **Products named:** Mailbutler, Superhuman, Boomerang, lockrMail, Unroll.me, Apparent for Gmail, GoodByEmail, Lindy, Leave Me Alone, Inbox Zero.

### A.9 "is clean email safe"

| Rank | Domain                   | URL                                                                         | Date       | Tool                 |
| ---- | ------------------------ | --------------------------------------------------------------------------- | ---------- | -------------------- |
| 1    | clean.email              | https://clean.email/is-clean-email-safe                                     | 2026-11-17 | WebSearch (standard) |
| 2    | clean.email              | https://clean.email/de/is-clean-email-safe                                  | 2026-11-17 | WebSearch (standard) |
| 3    | clean.email              | https://clean.email/blog/email-security/is-gmail-safe                       | 2026-11-17 | WebSearch (standard) |
| 4    | proton.me                | https://proton.me/blog/cs/clean-email                                       | 2026-11-17 | WebSearch (standard) |
| 5    | clean.email              | https://clean.email/blog/email-security/is-aol-mail-safe                    | 2026-11-17 | WebSearch (standard) |
| 6    | proton.me                | https://proton.me/blog/clean-email                                          | 2026-11-17 | WebSearch (standard) |
| 7    | clean.email              | https://clean.email/fr/is-clean-email-safe                                  | 2026-11-17 | WebSearch (standard) |
| 8    | hiddifysrv99.duckdns.org | https://hiddifysrv99.duckdns.org/blog/clean-email (mirror of a Proton page) | 2026-11-17 | WebSearch (standard) |

- Further: clean.email/pt, proton.me/hi, clean.email what-is-email-security (x2).
- **declutrmail.com:** not present. (DeclutrMail's nearest page is /answers/is-it-safe-to-connect-gmail-app.)
- **Products named:** Clean Email; Proton (as critic of inbox-access cleaners). The answer summary noted no independent security audit was found.

### A.10 "is unroll.me safe"

| Rank | Domain              | URL                                                       | Date       | Tool                 |
| ---- | ------------------- | --------------------------------------------------------- | ---------- | -------------------- |
| 1    | joindeleteme.com    | https://joindeleteme.com/is-site-safe/is-unroll-me-safe/  | 2026-11-17 | WebSearch (standard) |
| 2    | joindeleteme.com    | https://joindeleteme.com/?p=11343                         | 2026-11-17 | WebSearch (standard) |
| 3    | joindeleteme.com    | https://joindeleteme.com/is-site-safe/is-unroll-me-safe-2 | 2026-11-17 | WebSearch (standard) |
| 4    | producthunt.com     | https://www.producthunt.com/questions/is-unroll-me-safe   | 2026-11-17 | WebSearch (standard) |
| 5    | joindeleteme.com    | https://joindeleteme.com/?p=16670                         | 2026-11-17 | WebSearch (standard) |
| 6    | digitalcitizen.life | https://www.digitalcitizen.life/is-unroll-me-safe-to-use/ | 2026-11-17 | WebSearch (standard) |
| 7    | thebusinessdive.com | https://thebusinessdive.com/?p=19406                      | 2026-11-17 | WebSearch (standard) |
| 8    | rigorousthemes.com  | https://rigorousthemes.com/blog/is-unroll-me-safe/        | 2026-11-17 | WebSearch (standard) |

- Further: ora.it.com, proton.me, thebusinessdive.com/unroll-me-review, leavemealone.com (x2), parental-control.flashget.com, getmailbird.com/de, a Reddit mirror (lr.eu.psf.lt, r/Technology_Reviews thread on Unroll.me after its FTC case), clean.email/ja.
- **declutrmail.com:** not present.
- **Products named:** Unroll.me, Cleanfox (both described as NielsenIQ-owned), Leave Me Alone, Clean Email, DeleteMe, Mailbird.

### A.11 "bulk unsubscribe gmail"

| Rank | Domain               | URL                                                                                                  | Date       | Tool                 |
| ---- | -------------------- | ---------------------------------------------------------------------------------------------------- | ---------- | -------------------- |
| 1    | mailmeteor.com       | https://mailmeteor.com/blog/how-to-unsubscribe-from-emails                                           | 2026-11-17 | WebSearch (standard) |
| 2    | online-tech-tips.com | https://www.online-tech-tips.com/bulk-unsubscribe-emails-gmail-manage-subscriptions/                 | 2026-11-17 | WebSearch (standard) |
| 3    | workspace.google.com | https://workspace.google.com/marketplace/app/unsubscribe_peruuta_tilaus_kerralla/1094604469280?hl=he | 2026-11-17 | WebSearch (standard) |
| 4    | blog.superhuman.com  | https://blog.superhuman.com/bulk-unsubscribe-from-emails/                                            | 2026-11-17 | WebSearch (standard) |
| 5    | workspace.google.com | https://workspace.google.com/marketplace/app/unsubscribe_ai_inbox_shield_bulk_email_c/1094604469280  | 2026-11-17 | WebSearch (standard) |
| 6    | blog.incogni.com     | https://blog.incogni.com/?p=16455                                                                    | 2026-11-17 | WebSearch (standard) |
| 7    | hiverhq.com          | https://hiverhq.com/?p=53775                                                                         | 2026-11-17 | WebSearch (standard) |
| 8    | blog.incogni.com     | https://blog.incogni.com/how-to-unsubscribe-from-emails-on-gmail-in-bulk/                            | 2026-11-17 | WebSearch (standard) |

- Further: getmailbird.com, mailmeteor.com (gmail-unsubscribe), foxnews.com, againstdata.com, cleanmymac.com, techloy.com, chromeboard.com (x2).
- **declutrmail.com:** not present. DeclutrMail's matching page is /how-to/unsubscribe-from-emails-gmail.
- **Products named:** Gmail Manage subscriptions, Clean Email, Unroll.me, Mailstrom, Gmail Bulk Unsubscriber (Chrome), Bulk Unsubscribe for Gmail (Chrome), "Unsubscribe" Workspace add-on, Incogni.

### A.12 "gmail sort by sender"

| Rank | Domain                                      | URL                                                                                                                                              | Date       | Tool                 |
| ---- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | -------------------- |
| 1    | businessinsider.nl                          | https://businessinsider.nl/how-to-sort-by-sender-and-more-in-gmail-to-find-your-most-important-messages                                          | 2026-11-17 | WebSearch (standard) |
| 2    | businessinsider.in                          | https://www.businessinsider.in/tech/how-to/how-to-sort-by-sender-and-more-in-gmail-to-find-your-most-important-messages/articleshow/86081739.cms | 2026-11-17 | WebSearch (standard) |
| 3    | mailmeteor.com                              | https://mailmeteor.com/blog/sort-gmail-by-sender                                                                                                 | 2026-11-17 | WebSearch (standard) |
| 4    | helpdeskgeek.com                            | https://helpdeskgeek.com/sort-gmail-by-sender/                                                                                                   | 2026-11-17 | WebSearch (standard) |
| 5    | helpdeskgeek.com                            | https://helpdeskgeek.com/how-to/sort-gmail-by-sender/                                                                                            | 2026-11-17 | WebSearch (standard) |
| 6    | online-tech-tips.com                        | https://www.online-tech-tips.com/sort-gmail-by-sender-subject-label-size/                                                                        | 2026-11-17 | WebSearch (standard) |
| 7    | presentationbuilder.internationaltrucks.com | https://presentationbuilder.internationaltrucks.com/gmail-sort-emails-sender (spam-like)                                                         | 2026-11-17 | WebSearch (standard) |
| 8    | howtogeek.com                               | https://www.howtogeek.com/742632/how-to-sort-emails-by-sender-in-gmail/                                                                          | 2026-11-17 | WebSearch (standard) |
| 1    | howtogeek.com                               | https://www.howtogeek.com/742632/how-to-sort-emails-by-sender-in-gmail/                                                                          | 2026-11-17 | WebSearch (extended) |
| 2    | mailmeteor.com                              | https://mailmeteor.com/blog/sort-gmail-by-sender                                                                                                 | 2026-11-17 | WebSearch (extended) |
| 3    | androidauthority.com                        | https://www.androidauthority.com/how-to-sort-emails-gmail-3057762/                                                                               | 2026-11-17 | WebSearch (extended) |
| 4    | hubspot.com                                 | https://www.hubspot.com/email-signature-generator/organize-email-gmail                                                                           | 2026-11-17 | WebSearch (extended) |
| 5    | wisestamp.com                               | https://www.wisestamp.com/blog/sort-emails-in-gmail/                                                                                             | 2026-11-17 | WebSearch (extended) |
| 6    | clean.email                                 | https://clean.email/how-to-sort-emails/how-to-sort-gmail-by-sender                                                                               | 2026-11-17 | WebSearch (extended) |
| 7    | getmailtracker.com                          | https://www.getmailtracker.com/blog/sort-gmail-by-sender                                                                                         | 2026-11-17 | WebSearch (extended) |
| 8    | yamm.com                                    | https://yamm.com/blog/how-to-sort-your-gmail-by-sender/                                                                                          | 2026-11-17 | WebSearch (extended) |

- Further standard: rightinbox.com, businessinsider.in (amp), clean.email/ja, maketecheasier.com, clean.email, groovypost.com, getmailtracker.com, supportbee.com, multcloud.com, itechguides.com, a spam-like .edu.br page. Further extended: zeroinbox.ai, gmailunsubscribe.com.
- **declutrmail.com:** not present (standard or extended). DeclutrMail's nearest page is /how-to/clean-gmail-by-sender.
- **Products named:** Clean Email (Group By); extended adds Gmail Unsubscribe (gmailunsubscribe.com), Zero Inbox, YAMM. Two extended sources state Gmail cannot rank senders by volume, which is the gap a sender-grouped tool fills.

### A.13 "declutrmail"

| Rank | Domain            | URL                                                                                    | Date       | Tool                 |
| ---- | ----------------- | -------------------------------------------------------------------------------------- | ---------- | -------------------- |
| 1    | alternativeto.net | https://alternativeto.net/software/decluttermymail/about/ (DeclutterMyMail, unrelated) | 2026-11-17 | WebSearch (standard) |
| 2    | alternativeto.net | https://alternativeto.net/software/decluttermymail/                                    | 2026-11-17 | WebSearch (standard) |
| 3    | fastmail.com      | https://fastmail.com/features/declutter                                                | 2026-11-17 | WebSearch (standard) |
| 4    | github.com        | https://www.github.com/mdigruber/mail_deleter (unrelated)                              | 2026-11-17 | WebSearch (standard) |
| 5    | mailbutler.io     | https://www.mailbutler.io/?p=29799                                                     | 2026-11-17 | WebSearch (standard) |
| 6    | clean.email       | https://clean.email/blog/email-management/how-to-declutter-email                       | 2026-11-17 | WebSearch (standard) |
| 7    | clean.email       | https://clean.email/de/glossary/inbox-decluttering                                     | 2026-11-17 | WebSearch (standard) |
| 8    | trimbox.io        | https://www.trimbox.io/blog/automation-in-email-decluttering                           | 2026-11-17 | WebSearch (standard) |
| 1    | declutrmail.com   | https://declutrmail.com/faq                                                            | 2026-11-17 | WebSearch (extended) |
| 2    | declutrmail.com   | https://declutrmail.com/terms                                                          | 2026-11-17 | WebSearch (extended) |
| 3    | declutrmail.com   | https://declutrmail.com/privacy                                                        | 2026-11-17 | WebSearch (extended) |
| 4    | declutrmail.com   | https://declutrmail.com/how-it-works                                                   | 2026-11-17 | WebSearch (extended) |
| 5    | declutrmail.com   | https://declutrmail.com/contact                                                        | 2026-11-17 | WebSearch (extended) |
| 6    | declutrmail.com   | https://declutrmail.com/vs/clean-email                                                 | 2026-11-17 | WebSearch (extended) |
| 7    | declutrmail.com   | https://declutrmail.com/                                                               | 2026-11-17 | WebSearch (extended) |
| 8    | declutrmail.com   | https://declutrmail.com/compare                                                        | 2026-11-17 | WebSearch (extended) |

- Extended positions 9-10: declutrmail.com/beta, declutrmail.com/vs/gmail.
- **declutrmail.com:** standard = not present (engine answered as if the query were a typo for "DeclutterMyMail"); extended = positions 1-10.
- **Products named (standard):** DeclutterMyMail, Fastmail, Clean Email, Trimbox, Unroll.me, GoodByEmail.
- **How the extended answer described DeclutrMail (2026-11-17):** sender-grouped Keep/Archive/Unsubscribe/Later/Delete, preview before actions, 30-day undo on Archive/Later/Delete, unsubscribe not reversible, "never fetches or stores full email contents", gmail.modify scope, Free/Plus/Pro, open beta. It also said "Sources conflict on how much is sent to an AI provider", attributing an Anthropic statement to the homepage. A curl of the homepage HTML on 2026-11-17 found no "Anthropic" string; /faq does contain it ("Only if you allow AI in the app…"). The homepage attribution is UNVERIFIED (it may come from client-rendered text or another page).

### A.14 "declutrmail review"

| Rank | Domain            | URL                                                                                                | Date       | Tool                 |
| ---- | ----------------- | -------------------------------------------------------------------------------------------------- | ---------- | -------------------- |
| 1    | alternativeto.net | https://alternativeto.net/software/decluttermymail/about/ (unrelated)                              | 2026-11-17 | WebSearch (standard) |
| 2    | alternativeto.net | https://alternativeto.net/software/decluttermymail/ (unrelated)                                    | 2026-11-17 | WebSearch (standard) |
| 3    | fastmail.com      | https://www.fastmail.com/features/declutter/                                                       | 2026-11-17 | WebSearch (standard) |
| 4    | producthunt.com   | https://www.producthunt.com/products/clean-inbox/reviews (Clean Inbox, unrelated)                  | 2026-11-17 | WebSearch (standard) |
| 5    | trimbox.io        | https://trimbox.io/blog/declutter-your-inbox-a-review-of-gmail-decluttering-apps-in-2024           | 2026-11-17 | WebSearch (standard) |
| 6    | notion.com        | https://www.notion.com/blog/gmail-cleaner-app                                                      | 2026-11-17 | WebSearch (standard) |
| 7    | trimbox.io        | https://www.trimbox.io/blog/automated-email-declutter-tools                                        | 2026-11-17 | WebSearch (standard) |
| 8    | chromeboard.com   | https://chromeboard.com/extension/declutter-my-gmail-eonoacecdfckaeibpopikfjlkecpahkl              | 2026-11-17 | WebSearch (standard) |
| 1    | trustpilot.com    | https://www.trustpilot.com/review/decluttr.com?b=… (Decluttr.com, a used-media company, unrelated) | 2026-11-17 | WebSearch (extended) |
| 2    | trustpilot.com    | https://www.trustpilot.com/review/decluttr.com (unrelated)                                         | 2026-11-17 | WebSearch (extended) |
| 3    | declutrmail.com   | https://declutrmail.com/vs/gmail                                                                   | 2026-11-17 | WebSearch (extended) |
| 4    | declutrmail.com   | https://declutrmail.com/vs/trimbox                                                                 | 2026-11-17 | WebSearch (extended) |
| 5    | declutrmail.com   | https://declutrmail.com/vs/clean-email                                                             | 2026-11-17 | WebSearch (extended) |
| 6    | declutrmail.com   | https://declutrmail.com/vs/sanebox                                                                 | 2026-11-17 | WebSearch (extended) |
| 7    | declutrmail.com   | https://declutrmail.com/vs/gmail-filters                                                           | 2026-11-17 | WebSearch (extended) |
| 8    | declutrmail.com   | https://declutrmail.com/vs/unroll-me                                                               | 2026-11-17 | WebSearch (extended) |

- Extended position 9: ch.trustpilot.com/review/mailcleanup.com (unrelated).
- **declutrmail.com:** standard = not present; extended = positions 3-8.
- The extended answer stated "I found no independent reviews of DeclutrMail" and quoted the free tier (one Gmail inbox, 50 cleanup actions a month) and the "new product with no enforcement history" line from the /vs/ pages.
- **Name collisions seen across brand searches:** DeclutterMyMail (alternativeto), Declutr (macOS file organizer, alternativeto), Decluttr.com (Trustpilot), DeCluttr Me (podcast), "Declutter my Gmail" (Chrome extension), Clean Inbox (Product Hunt).

---

## A2. Third-party mentions of DeclutrMail

| Source                                   | Method                                                                                          | URL found                                                                                                                               | What it says                                                                                                                                                                                                                                 | Date       | Tool                 |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------- |
| GitHub                                   | WebSearch extended, "declutrmail", declutrmail.com blocked                                      | https://github.com/CT2689-Tech/DeclutrMail                                                                                              | The project's public repository (first-party content on a third-party host). The answer engine used it to describe the product and noted the repo "points to declutr-mail.vercel.app".                                                       | 2026-11-17 | WebSearch (extended) |
| GitHub                                   | same search                                                                                     | https://github.com/CT2689-Tech/DeclutrMail/issues/1003                                                                                  | Issue "Content audit Oct 12: all site copy, SEO and AI-search fixes". The answer engine repeated from it that "legal entity and maker name were still pending" and that a search for "DeclutrMail" Gmail returns only declutrmail.com pages. | 2026-11-17 | WebSearch (extended) |
| GitHub                                   | same search                                                                                     | https://github.com/CT2689-Tech/DeclutrMail/pull/1088, /pull/1098, /pull/772, /pull/1072, /pull/1116, /pull/1143, /pull/1150, /pull/1168 | Merged PR pages (share-card headline, alert noise, notification claims, privacy copy, native mobile shell, Home action overview, account visuals, public logos). The engine summarised them as "internal development artifacts".             | 2026-11-17 | WebSearch (extended) |
| Reddit                                   | WebSearch with `allowed_domains: reddit.com`                                                    | —                                                                                                                                       | Refused by the tool ("reddit.com not accessible to our user agent").                                                                                                                                                                         | 2026-11-17 | WebSearch            |
| Reddit                                   | curl `https://www.reddit.com/search.json?q=declutrmail`                                         | —                                                                                                                                       | HTTP 403. **UNVERIFIED.**                                                                                                                                                                                                                    | 2026-11-17 | curl                 |
| Reddit                                   | WebSearch standard `"declutrmail" reddit`                                                       | —                                                                                                                                       | No Reddit thread mentioning DeclutrMail; only reddit mirrors of unrelated r/declutter and r/gtd posts. None found in this search.                                                                                                            | 2026-11-17 | WebSearch (standard) |
| Product Hunt                             | WebSearch standard, allowed_domains incl. producthunt.com                                       | —                                                                                                                                       | None found in this search.                                                                                                                                                                                                                   | 2026-11-17 | WebSearch (standard) |
| Product Hunt                             | curl `https://www.producthunt.com/products/declutrmail`                                         | —                                                                                                                                       | HTTP 403. **UNVERIFIED.**                                                                                                                                                                                                                    | 2026-11-17 | curl                 |
| AlternativeTo                            | WebSearch standard, allowed_domains incl. alternativeto.net                                     | —                                                                                                                                       | None found; only DeclutterMyMail and Declutr (different products).                                                                                                                                                                           | 2026-11-17 | WebSearch (standard) |
| AlternativeTo                            | curl `https://alternativeto.net/software/declutrmail/`                                          | —                                                                                                                                       | HTTP 403. **UNVERIFIED.**                                                                                                                                                                                                                    | 2026-11-17 | curl                 |
| G2                                       | WebSearch standard, allowed_domains incl. g2.com                                                | —                                                                                                                                       | None found in this search.                                                                                                                                                                                                                   | 2026-11-17 | WebSearch (standard) |
| G2                                       | curl `https://www.g2.com/products/declutrmail/reviews`                                          | —                                                                                                                                       | HTTP 403. **UNVERIFIED.**                                                                                                                                                                                                                    | 2026-11-17 | curl                 |
| Indie Hackers                            | WebSearch standard, allowed_domains incl. indiehackers.com                                      | —                                                                                                                                       | None found in this search.                                                                                                                                                                                                                   | 2026-11-17 | WebSearch (standard) |
| X / Twitter                              | WebSearch standard, allowed_domains x.com, twitter.com                                          | —                                                                                                                                       | None found in this search (unrelated results: an Andrew Warner post on using Claude to declutter an inbox, a Proton Mail tips post, disposable-mail accounts).                                                                               | 2026-11-17 | WebSearch (standard) |
| Hacker News                              | curl HN Algolia API `search?query=declutrmail&tags=(story,comment)` and `query=declutrmail.com` | —                                                                                                                                       | nbHits = 0 for both. None found.                                                                                                                                                                                                             | 2026-11-17 | curl                 |
| Hacker News                              | WebSearch standard, allowed_domains incl. news.ycombinator.com                                  | https://news.ycombinator.com/item?id=47645719                                                                                           | "Show HN: mailtrim", a different Gmail sender-cleanup tool (not a DeclutrMail mention; noted as a competitor sighting).                                                                                                                      | 2026-11-17 | WebSearch (standard) |
| Any (extended, declutrmail.com excluded) | WebSearch extended, blocked_domains declutrmail.com                                             | —                                                                                                                                       | Only the GitHub repo/issues/PRs above. No review, listing, forum or social post found.                                                                                                                                                       | 2026-11-17 | WebSearch (extended) |

**Summary:** no independent third-party mention of DeclutrMail was found in these searches on 2026-11-17. Reddit, Product Hunt, AlternativeTo and G2 could not be checked directly (403), so absence there is UNVERIFIED beyond what WebSearch indexed.

### Competitors seen in results that DeclutrMail has no /vs/ or /alternatives/ page for (2026-11-17)

Observed in the result lists above (presence only; no ranking claim): Mailstrom (has /vs/), InboxPurge (has /vs/), MailMop (has /vs/) — and **without** a DeclutrMail page: Cleanfox, Gmailytics, PureBox, MailSweeper, InboxZapper, verified.email, Inbox Zero (getinboxzero.com), Gmail Unsubscribe (gmailunsubscribe.com), Email Unsubscriber, Miniletter, MailLedger, Klearbox, AgainstData, Block Sender, Canary Mail, Yorba, lockrMail, Gmail One-Click Cleaner, Mult Cleaner, Cleanbox, Adinand Email Cleaner, mailtrim, CleanMyMac Email Cleanup, Superhuman/Shortwave/Spark (clients).

## B1. Autocomplete suggestions

Source: `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=<seed+modifier>` (Google autocomplete, no location set). 15 seeds x 9 modifiers ("", " how", " app", " free", " by sender", " without", " vs", " alternative", " safe") = **135 requests**, 0 errors, 0.3 s apart. Date 2026-11-17. Tool: curl-equivalent HTTP GET (python urllib from Bash).

- Raw suggestions returned: 560; **unique after dedup: 485**; flagged off-topic: 16.
- Modifiers that returned **zero** suggestions are listed per seed (no autocomplete for that phrasing on 2026-11-17).
- Each suggestion appears once, under the first seed that produced it. `(off-topic)` marks suggestions unrelated to email cleanup; `(non-Gmail provider)` marks other-provider phrasings. No volumes are implied by order.

### Seed: "gmail cleanup" (31 new unique; date 2026-11-17; tool curl)

Zero-suggestion modifiers: ' without', ' vs', ' alternative', ' safe'

| Suggestion                                            | Date       | Tool |
| ----------------------------------------------------- | ---------- | ---- |
| gmail cleanup                                         | 2026-11-17 | curl |
| gmail cleanup tool                                    | 2026-11-17 | curl |
| gmail cleanup app                                     | 2026-11-17 | curl |
| gmail cleanup tips                                    | 2026-11-17 | curl |
| gmail cleanup tool free                               | 2026-11-17 | curl |
| gmail cleanup extension                               | 2026-11-17 | curl |
| gmail cleanup free                                    | 2026-11-17 | curl |
| gmail cleanup reddit                                  | 2026-11-17 | curl |
| gmail cleanup space                                   | 2026-11-17 | curl |
| gmail cleanup promotions                              | 2026-11-17 | curl |
| gmail cleanup how to                                  | 2026-11-17 | curl |
| what is the easiest way to clean up gmail             | 2026-11-17 | curl |
| gmail cleanup tools                                   | 2026-11-17 | curl |
| gmail cleanup app free                                | 2026-11-17 | curl |
| gmail cleaner app                                     | 2026-11-17 | curl |
| gmail cleaner app reddit                              | 2026-11-17 | curl |
| gmail cleaner app for android                         | 2026-11-17 | curl |
| gmail storage cleanup app                             | 2026-11-17 | curl |
| best gmail cleanup app                                | 2026-11-17 | curl |
| gmail clean up space app                              | 2026-11-17 | curl |
| gmail account cleanup                                 | 2026-11-17 | curl |
| how to clean up gmail                                 | 2026-11-17 | curl |
| gmail cleaner free                                    | 2026-11-17 | curl |
| gmail cleaner free online                             | 2026-11-17 | curl |
| gmail cleaner free reddit                             | 2026-11-17 | curl |
| gmail inbox cleanup free                              | 2026-11-17 | curl |
| best gmail cleanup tool free                          | 2026-11-17 | curl |
| easy gmail cleanup                                    | 2026-11-17 | curl |
| clean up gmail by sender                              | 2026-11-17 | curl |
| gmail email cleanup                                   | 2026-11-17 | curl |
| how to delete all the emails from one sender in gmail | 2026-11-17 | curl |

### Seed: "clean up gmail" (45 new unique; date 2026-11-17; tool curl)

Zero-suggestion modifiers: ' vs', ' alternative', ' safe'

| Suggestion                                              | Date       | Tool |
| ------------------------------------------------------- | ---------- | ---- |
| clean up gmail                                          | 2026-11-17 | curl |
| clean up gmail storage                                  | 2026-11-17 | curl |
| clean up gmail inbox                                    | 2026-11-17 | curl |
| clean up gmail storage fast                             | 2026-11-17 | curl |
| clean up gmail space                                    | 2026-11-17 | curl |
| clean up gmail account                                  | 2026-11-17 | curl |
| clean up gmail app                                      | 2026-11-17 | curl |
| clean up gmail emails                                   | 2026-11-17 | curl |
| clean up gmail for free                                 | 2026-11-17 | curl |
| clean up gmail subscriptions                            | 2026-11-17 | curl |
| how clean up gmail storage                              | 2026-11-17 | curl |
| how clean up gmail                                      | 2026-11-17 | curl |
| how clean up gmail inbox                                | 2026-11-17 | curl |
| how clean up gmail account                              | 2026-11-17 | curl |
| how to clean up gmail storage on phone                  | 2026-11-17 | curl |
| how to clean up gmail on phone                          | 2026-11-17 | curl |
| how to clean up gmail storage quickly                   | 2026-11-17 | curl |
| how to clean up gmail inbox quickly                     | 2026-11-17 | curl |
| how to clean up gmail space                             | 2026-11-17 | curl |
| how to clean up gmail quickly                           | 2026-11-17 | curl |
| clean out gmail app                                     | 2026-11-17 | curl |
| clean up gmail storage app                              | 2026-11-17 | curl |
| clean up space gmail app                                | 2026-11-17 | curl |
| clean up gmail inbox app                                | 2026-11-17 | curl |
| gmail clean up app free                                 | 2026-11-17 | curl |
| best gmail clean up app                                 | 2026-11-17 | curl |
| app to clean up gmail account                           | 2026-11-17 | curl |
| email junk clean up in gmail app                        | 2026-11-17 | curl |
| best app to clean up gmail inbox                        | 2026-11-17 | curl |
| clean up gmail free                                     | 2026-11-17 | curl |
| clean up gmail inbox free                               | 2026-11-17 | curl |
| clean up gmail storage free                             | 2026-11-17 | curl |
| clean up email gmail free                               | 2026-11-17 | curl |
| app to clean up gmail free                              | 2026-11-17 | curl |
| gmail clean up tool free                                | 2026-11-17 | curl |
| how to clean up gmail space for free                    | 2026-11-17 | curl |
| free app to clean up gmail inbox                        | 2026-11-17 | curl |
| free way to clean up gmail                              | 2026-11-17 | curl |
| free ai to clean up gmail                               | 2026-11-17 | curl |
| how to clean up gmail without deleting important emails | 2026-11-17 | curl |
| how to clean up gmail without paying                    | 2026-11-17 | curl |
| how to clean up gmail storage without paying            | 2026-11-17 | curl |
| how to clean up gmail storage without deleting anything | 2026-11-17 | curl |
| how to clean up gmail storage without deleting photos   | 2026-11-17 | curl |
| how to clean up gmail storage without google one        | 2026-11-17 | curl |

### Seed: "delete emails gmail" (47 new unique; date 2026-11-17; tool curl)

Zero-suggestion modifiers: ' vs', ' alternative', ' safe'

| Suggestion                                                 | Date       | Tool |
| ---------------------------------------------------------- | ---------- | ---- |
| delete emails gmail                                        | 2026-11-17 | curl |
| delete emails gmail bulk                                   | 2026-11-17 | curl |
| delete emails gmail app                                    | 2026-11-17 | curl |
| delete emails gmail iphone                                 | 2026-11-17 | curl |
| delete emails gmail on android                             | 2026-11-17 | curl |
| delete emails gmail ipad                                   | 2026-11-17 | curl |
| delete emails gmail fast                                   | 2026-11-17 | curl |
| deleted emails gmail recovery                              | 2026-11-17 | curl |
| delete email gmail shortcut                                | 2026-11-17 | curl |
| delete email gmail account                                 | 2026-11-17 | curl |
| deleted email from gmail how to get it back                | 2026-11-17 | curl |
| deleted email on gmail how to recover                      | 2026-11-17 | curl |
| how delete emails gmail                                    | 2026-11-17 | curl |
| how delete gmail emails in bulk                            | 2026-11-17 | curl |
| how to delete emails gmail app                             | 2026-11-17 | curl |
| how to delete emails gmail on iphone                       | 2026-11-17 | curl |
| how to delete emails gmail fast                            | 2026-11-17 | curl |
| how to delete emails gmail account                         | 2026-11-17 | curl |
| how to delete emails gmail on phone                        | 2026-11-17 | curl |
| how mass delete emails gmail                               | 2026-11-17 | curl |
| delete email gmail app iphone                              | 2026-11-17 | curl |
| delete messages gmail app                                  | 2026-11-17 | curl |
| delete email gmail android                                 | 2026-11-17 | curl |
| mass delete emails gmail app                               | 2026-11-17 | curl |
| delete all emails gmail app                                | 2026-11-17 | curl |
| delete multiple emails gmail app                           | 2026-11-17 | curl |
| bulk delete emails gmail app                               | 2026-11-17 | curl |
| delete unread emails gmail app                             | 2026-11-17 | curl |
| mass delete emails gmail app iphone                        | 2026-11-17 | curl |
| mass delete emails gmail free                              | 2026-11-17 | curl |
| does deleting gmail emails free up storage                 | 2026-11-17 | curl |
| how to delete gmail emails to free up space                | 2026-11-17 | curl |
| how to delete gmail emails to free up storage              | 2026-11-17 | curl |
| what is the easiest way to delete emails from gmail        | 2026-11-17 | curl |
| can you permanently delete emails from gmail               | 2026-11-17 | curl |
| can't delete gmail emails                                  | 2026-11-17 | curl |
| delete forever emails gmail                                | 2026-11-17 | curl |
| delete gmail emails by sender                              | 2026-11-17 | curl |
| mass delete gmail emails by sender                         | 2026-11-17 | curl |
| delete all emails by sender gmail                          | 2026-11-17 | curl |
| can i delete emails by sender in gmail                     | 2026-11-17 | curl |
| how do i delete emails from my gmail on all devices        | 2026-11-17 | curl |
| delete email by date gmail                                 | 2026-11-17 | curl |
| is there a way to delete all emails from a sender in gmail | 2026-11-17 | curl |
| how do i delete all emails from one sender in gmail        | 2026-11-17 | curl |
| deleted gmail emails not in trash                          | 2026-11-17 | curl |
| delete gmail permanently                                   | 2026-11-17 | curl |

### Seed: "gmail storage full" (31 new unique; date 2026-11-17; tool curl)

Zero-suggestion modifiers: ' by sender', ' vs', ' alternative', ' safe'

| Suggestion                                      | Date       | Tool |
| ----------------------------------------------- | ---------- | ---- |
| gmail storage full                              | 2026-11-17 | curl |
| gmail storage full what to do                   | 2026-11-17 | curl |
| gmail storage full reddit                       | 2026-11-17 | curl |
| gmail storage full but nothing to delete        | 2026-11-17 | curl |
| gmail storage full how to fix                   | 2026-11-17 | curl |
| gmail storage full how to delete                | 2026-11-17 | curl |
| gmail storage full solution                     | 2026-11-17 | curl |
| gmail storage full not receiving emails         | 2026-11-17 | curl |
| gmail storage full email                        | 2026-11-17 | curl |
| gmail storage full scam                         | 2026-11-17 | curl |
| gmail storage full how to clear                 | 2026-11-17 | curl |
| gmail storage full how to compress              | 2026-11-17 | curl |
| gmail storage full how to clear in tamil        | 2026-11-17 | curl |
| gmail storage full how to clean                 | 2026-11-17 | curl |
| gmail storage full how to solve                 | 2026-11-17 | curl |
| gmail storage full how to clear in hindi        | 2026-11-17 | curl |
| gmail storage full how to delete in mobile      | 2026-11-17 | curl |
| gmail storage full how to get emails            | 2026-11-17 | curl |
| gmail app storage full                          | 2026-11-17 | curl |
| why is my gmail storage full                    | 2026-11-17 | curl |
| can gmail storage be full                       | 2026-11-17 | curl |
| why does gmail take up so much storage          | 2026-11-17 | curl |
| gmail full storage free                         | 2026-11-17 | curl |
| gmail not working storage full                  | 2026-11-17 | curl |
| gmail free storage limit                        | 2026-11-17 | curl |
| gmail storage full not receiving emails reddit  | 2026-11-17 | curl |
| gmail storage full no emails                    | 2026-11-17 | curl |
| gmail storage full not getting emails           | 2026-11-17 | curl |
| gmail storage full not receiving emails android | 2026-11-17 | curl |
| gmail storage full but no emails                | 2026-11-17 | curl |
| what happens when gmail storage is full         | 2026-11-17 | curl |

### Seed: "unsubscribe gmail" (41 new unique; date 2026-11-17; tool curl)

Zero-suggestion modifiers: ' by sender', ' alternative'

| Suggestion                                      | Date       | Tool |
| ----------------------------------------------- | ---------- | ---- |
| unsubscribe gmail                               | 2026-11-17 | curl |
| unsubscribe gmail bulk                          | 2026-11-17 | curl |
| unsubscribe gmail emails                        | 2026-11-17 | curl |
| unsubscribe gmail app                           | 2026-11-17 | curl |
| unsubscribe emails                              | 2026-11-17 | curl |
| unsubscribe emails in bulk                      | 2026-11-17 | curl |
| unsubscribe emails yahoo (non-Gmail provider)   | 2026-11-17 | curl |
| unsubscribe emails app                          | 2026-11-17 | curl |
| unsubscribe emails outlook (non-Gmail provider) | 2026-11-17 | curl |
| unsubscribe emails on iphone                    | 2026-11-17 | curl |
| unsubscribe gmail how to                        | 2026-11-17 | curl |
| gmail unsubscribe how does it work              | 2026-11-17 | curl |
| gmail unsubscribe what does it do               | 2026-11-17 | curl |
| gmail unsubscribe button how does it work       | 2026-11-17 | curl |
| gmail unsubscribe tool how does it work         | 2026-11-17 | curl |
| how unsubscribe gmail emails                    | 2026-11-17 | curl |
| how to unsubscribe everything on gmail          | 2026-11-17 | curl |
| how to unsubscribe using gmail                  | 2026-11-17 | curl |
| unsubscribe emails gmail app                    | 2026-11-17 | curl |
| mass unsubscribe gmail app                      | 2026-11-17 | curl |
| gmail unsubscribe tool app                      | 2026-11-17 | curl |
| gmail app unsubscribe button                    | 2026-11-17 | curl |
| unsubscribe gmail free                          | 2026-11-17 | curl |
| mass unsubscribe gmail free                     | 2026-11-17 | curl |
| bulk unsubscribe gmail free                     | 2026-11-17 | curl |
| unsubscribe emails gmail free                   | 2026-11-17 | curl |
| gmail unsubscribe tool free                     | 2026-11-17 | curl |
| gmail unsubscribe extension free                | 2026-11-17 | curl |
| is gmail unsubscribe safe                       | 2026-11-17 | curl |
| what does gmail unsubscribe do                  | 2026-11-17 | curl |
| does gmail unsubscribe work                     | 2026-11-17 | curl |
| gmail unsubscribe not working                   | 2026-11-17 | curl |
| unsubscribe not showing in gmail                | 2026-11-17 | curl |
| unsubscribe no gmail                            | 2026-11-17 | curl |
| gmail.unsubscribe vs block                      | 2026-11-17 | curl |
| what does unsubscribe mean in gmail             | 2026-11-17 | curl |
| how to unsubscribe multiple emails in gmail     | 2026-11-17 | curl |
| gmail unsubscribe safe                          | 2026-11-17 | curl |
| gmail unsubscribe button safe                   | 2026-11-17 | curl |
| is it safe to unsubscribe from emails           | 2026-11-17 | curl |
| how to unsubscribe unwanted emails in gmail     | 2026-11-17 | curl |

### Seed: "gmail sort by sender" (25 new unique; date 2026-11-17; tool curl)

Zero-suggestion modifiers: ' free', ' by sender', ' without', ' vs', ' alternative', ' safe'

| Suggestion                                   | Date       | Tool |
| -------------------------------------------- | ---------- | ---- |
| gmail sort by sender                         | 2026-11-17 | curl |
| gmail sort by sender with most emails        | 2026-11-17 | curl |
| gmail sort by sender extension               | 2026-11-17 | curl |
| gmail sort by sender alphabetically          | 2026-11-17 | curl |
| gmail sort by sender name                    | 2026-11-17 | curl |
| gmail sort by sender count                   | 2026-11-17 | curl |
| gmail sort by sender reddit                  | 2026-11-17 | curl |
| sort gmail by sender on iphone               | 2026-11-17 | curl |
| sort gmail by sender on mobile               | 2026-11-17 | curl |
| gmail order by sender                        | 2026-11-17 | curl |
| gmail how sort by sender                     | 2026-11-17 | curl |
| how to sort gmail by sender alphabetically   | 2026-11-17 | curl |
| how to sort gmail by sender name             | 2026-11-17 | curl |
| how to sort gmail by sender on iphone        | 2026-11-17 | curl |
| how to sort gmail by sender on android phone | 2026-11-17 | curl |
| how to sort gmail by sender on ipad          | 2026-11-17 | curl |
| gmail inbox how to sort by sender            | 2026-11-17 | curl |
| how to sort gmail by sender on mac           | 2026-11-17 | curl |
| how to sort gmail by sender in browser       | 2026-11-17 | curl |
| how to make gmail sort by sender             | 2026-11-17 | curl |
| gmail app sort by sender                     | 2026-11-17 | curl |
| can you sort gmail by sender                 | 2026-11-17 | curl |
| how do i sort my emails by sender in gmail   | 2026-11-17 | curl |
| how do i sort gmail by sender alphabetically | 2026-11-17 | curl |
| can you sort your gmail inbox by sender      | 2026-11-17 | curl |

### Seed: "mass delete gmail" (36 new unique; date 2026-11-17; tool curl)

Zero-suggestion modifiers: ' vs', ' alternative', ' safe'

| Suggestion                                            | Date       | Tool |
| ----------------------------------------------------- | ---------- | ---- |
| mass delete gmail emails                              | 2026-11-17 | curl |
| mass delete gmail                                     | 2026-11-17 | curl |
| mass delete gmail emails by date                      | 2026-11-17 | curl |
| mass delete gmail emails on iphone                    | 2026-11-17 | curl |
| mass delete gmail inbox                               | 2026-11-17 | curl |
| mass delete gmail emails from one sender              | 2026-11-17 | curl |
| mass delete gmail emails before a certain date        | 2026-11-17 | curl |
| mass delete gmail app                                 | 2026-11-17 | curl |
| mass delete gmail promotion emails                    | 2026-11-17 | curl |
| how mass delete gmail emails                          | 2026-11-17 | curl |
| how mass delete gmail                                 | 2026-11-17 | curl |
| how to mass delete gmail emails on iphone             | 2026-11-17 | curl |
| how to mass delete gmail inbox                        | 2026-11-17 | curl |
| how to mass delete gmail messages                     | 2026-11-17 | curl |
| how to mass delete gmail on iphone                    | 2026-11-17 | curl |
| how to mass delete gmail promotion emails             | 2026-11-17 | curl |
| how to mass delete gmail emails on phone              | 2026-11-17 | curl |
| how to mass delete gmail emails before a certain date | 2026-11-17 | curl |
| how to mass delete gmail emails on android            | 2026-11-17 | curl |
| mass delete gmail app iphone                          | 2026-11-17 | curl |
| bulk delete gmail app                                 | 2026-11-17 | curl |
| batch delete gmail app                                | 2026-11-17 | curl |
| mass delete gmail android                             | 2026-11-17 | curl |
| mass delete promotions gmail app                      | 2026-11-17 | curl |
| bulk delete gmail android                             | 2026-11-17 | curl |
| mass delete gmail free                                | 2026-11-17 | curl |
| can you mass delete gmail                             | 2026-11-17 | curl |
| mass delete in gmail                                  | 2026-11-17 | curl |
| mass delete gmail by sender                           | 2026-11-17 | curl |
| mass delete gmail from one sender                     | 2026-11-17 | curl |
| how do you mass delete emails from gmail              | 2026-11-17 | curl |
| is there a way to mass delete emails in gmail         | 2026-11-17 | curl |
| mass delete gmail not working                         | 2026-11-17 | curl |
| mass delete gmail emails not working                  | 2026-11-17 | curl |
| how to mass delete gmail                              | 2026-11-17 | curl |
| how do you mass delete gmail                          | 2026-11-17 | curl |

### Seed: "gmail auto archive" (15 new unique; date 2026-11-17; tool curl)

Zero-suggestion modifiers: ' app', ' free', ' without', ' vs', ' alternative', ' safe'

| Suggestion                                                   | Date       | Tool |
| ------------------------------------------------------------ | ---------- | ---- |
| gmail auto archive                                           | 2026-11-17 | curl |
| gmail auto archive after x days                              | 2026-11-17 | curl |
| gmail auto archive emails                                    | 2026-11-17 | curl |
| gmail auto archive settings                                  | 2026-11-17 | curl |
| gmail auto archive after 30 days                             | 2026-11-17 | curl |
| gmail auto archive rule                                      | 2026-11-17 | curl |
| how to auto archive old emails in gmail                      | 2026-11-17 | curl |
| gmail auto archive from sender                               | 2026-11-17 | curl |
| gmail automatically archive                                  | 2026-11-17 | curl |
| gmail archive auto delete                                    | 2026-11-17 | curl |
| gmail how to auto archive                                    | 2026-11-17 | curl |
| how to auto archive emails in gmail                          | 2026-11-17 | curl |
| how to stop auto archive in gmail                            | 2026-11-17 | curl |
| how do i stop gmail from archiving all my mail automatically | 2026-11-17 | curl |
| does gmail automatically archive emails                      | 2026-11-17 | curl |

### Seed: "gmail filter" (48 new unique; date 2026-11-17; tool curl)

Zero-suggestion modifiers: ' free', ' alternative', ' safe'

| Suggestion                                     | Date       | Tool |
| ---------------------------------------------- | ---------- | ---- |
| gmail filters                                  | 2026-11-17 | curl |
| gmail filter for unread                        | 2026-11-17 | curl |
| gmail filter or                                | 2026-11-17 | curl |
| gmail filter multiple email addresses          | 2026-11-17 | curl |
| gmail filter rules                             | 2026-11-17 | curl |
| gmail filter regex                             | 2026-11-17 | curl |
| gmail filter subject contains                  | 2026-11-17 | curl |
| gmail filter from multiple addresses           | 2026-11-17 | curl |
| gmail filter settings                          | 2026-11-17 | curl |
| gmail filters and blocked addresses            | 2026-11-17 | curl |
| gmail filter how to                            | 2026-11-17 | curl |
| gmail spam filter how does it work             | 2026-11-17 | curl |
| how to set filter on gmail                     | 2026-11-17 | curl |
| gmail filter rule                              | 2026-11-17 | curl |
| how do i set filters in gmail                  | 2026-11-17 | curl |
| how to put filters in gmail                    | 2026-11-17 | curl |
| gmail filter apply multiple labels             | 2026-11-17 | curl |
| gmail filter app                               | 2026-11-17 | curl |
| gmail filter apply to existing mail            | 2026-11-17 | curl |
| gmail filter apply label and remove from inbox | 2026-11-17 | curl |
| gmail filter apply two labels                  | 2026-11-17 | curl |
| gmail filter apply label                       | 2026-11-17 | curl |
| gmail apply filter to existing emails          | 2026-11-17 | curl |
| gmail app filter unread                        | 2026-11-17 | curl |
| gmail apply filter                             | 2026-11-17 | curl |
| gmail app filter settings                      | 2026-11-17 | curl |
| gmail filter by sender                         | 2026-11-17 | curl |
| gmail filter by sender domain                  | 2026-11-17 | curl |
| gmail filter by sender name                    | 2026-11-17 | curl |
| gmail filter without label                     | 2026-11-17 | curl |
| gmail filter without attachment                | 2026-11-17 | curl |
| gmail filter not working                       | 2026-11-17 | curl |
| gmail filter not from                          | 2026-11-17 | curl |
| gmail filter no label                          | 2026-11-17 | curl |
| gmail filter not read                          | 2026-11-17 | curl |
| gmail filter not starred                       | 2026-11-17 | curl |
| gmail filter not label                         | 2026-11-17 | curl |
| gmail filter not from address                  | 2026-11-17 | curl |
| gmail filter not in inbox                      | 2026-11-17 | curl |
| gmail filter or condition                      | 2026-11-17 | curl |
| gmail filter or operator                       | 2026-11-17 | curl |
| gmail filter and blocked addresses             | 2026-11-17 | curl |
| gmail filter and move to folder                | 2026-11-17 | curl |
| gmail filter and forward                       | 2026-11-17 | curl |
| gmail filter 'or' statement                    | 2026-11-17 | curl |
| gmail filter and delete all                    | 2026-11-17 | curl |
| gmail filter and not                           | 2026-11-17 | curl |
| gmail filter or email                          | 2026-11-17 | curl |

### Seed: "inbox zero gmail" (12 new unique; date 2026-11-17; tool curl)

Zero-suggestion modifiers: ' app', ' free', ' by sender', ' without', ' vs', ' alternative', ' safe'

| Suggestion                     | Date       | Tool |
| ------------------------------ | ---------- | ---- |
| inbox zero gmail               | 2026-11-17 | curl |
| inbox zero gmail jeff su       | 2026-11-17 | curl |
| inbox zero gmail labels        | 2026-11-17 | curl |
| inbox zero gmail setup         | 2026-11-17 | curl |
| inbox zero method gmail        | 2026-11-17 | curl |
| inbox zero tabs for gmail      | 2026-11-17 | curl |
| gmail inbox zero strategy      | 2026-11-17 | curl |
| how to reach inbox zero gmail  | 2026-11-17 | curl |
| how to get gmail inbox to zero | 2026-11-17 | curl |
| is inbox zero worth it         | 2026-11-17 | curl |
| how to inbox zero gmail        | 2026-11-17 | curl |
| how to skip inbox in gmail     | 2026-11-17 | curl |

### Seed: "unroll.me" (52 new unique; date 2026-11-17; tool curl)

Zero-suggestion modifiers: ' by sender', ' without'

| Suggestion                          | Date       | Tool |
| ----------------------------------- | ---------- | ---- |
| unroll.me                           | 2026-11-17 | curl |
| unroll.me reviews                   | 2026-11-17 | curl |
| unroll.me app                       | 2026-11-17 | curl |
| unroll.me login                     | 2026-11-17 | curl |
| unroll.me legit                     | 2026-11-17 | curl |
| unroll.me reddit                    | 2026-11-17 | curl |
| unroll.me alternative               | 2026-11-17 | curl |
| unroll.me apk                       | 2026-11-17 | curl |
| unroll.me uk                        | 2026-11-17 | curl |
| unroll me how to use                | 2026-11-17 | curl |
| unroll me how does it work          | 2026-11-17 | curl |
| unroll me how to resubscribe        | 2026-11-17 | curl |
| unroll me how to                    | 2026-11-17 | curl |
| unroll me what does rollup mean     | 2026-11-17 | curl |
| unroll me what is rollup            | 2026-11-17 | curl |
| unroll me what does block mean      | 2026-11-17 | curl |
| what does rollup do in unroll me    | 2026-11-17 | curl |
| unroll me what does rollup do       | 2026-11-17 | curl |
| how to cancel unroll me             | 2026-11-17 | curl |
| unroll me app reviews               | 2026-11-17 | curl |
| unroll me app download              | 2026-11-17 | curl |
| unroll me app for android           | 2026-11-17 | curl |
| unroll me app reddit                | 2026-11-17 | curl |
| unroll me app rollup                | 2026-11-17 | curl |
| unroll me app legit                 | 2026-11-17 | curl |
| unroll me app safe                  | 2026-11-17 | curl |
| unroll me app not working           | 2026-11-17 | curl |
| unroll me apple                     | 2026-11-17 | curl |
| unroll me free                      | 2026-11-17 | curl |
| unroll me free alternative          | 2026-11-17 | curl |
| is unroll me free to use            | 2026-11-17 | curl |
| is unroll me app free               | 2026-11-17 | curl |
| does unroll me actually unsubscribe | 2026-11-17 | curl |
| is unroll me safe                   | 2026-11-17 | curl |
| unroll me vs clean email            | 2026-11-17 | curl |
| unroll me vs cleanfox               | 2026-11-17 | curl |
| unroll me vs                        | 2026-11-17 | curl |
| unroll me block vs rollup           | 2026-11-17 | curl |
| unroll me block vs unsubscribe      | 2026-11-17 | curl |
| unroll me unsubscribe vs rollup     | 2026-11-17 | curl |
| does unroll me work                 | 2026-11-17 | curl |
| unroll me alternative               | 2026-11-17 | curl |
| unroll me alternative reddit        | 2026-11-17 | curl |
| unroll me alternative eu            | 2026-11-17 | curl |
| unroll me alternative uk            | 2026-11-17 | curl |
| unroll me alternative europe        | 2026-11-17 | curl |
| best unroll me alternative          | 2026-11-17 | curl |
| is unroll me free                   | 2026-11-17 | curl |
| unroll me safe                      | 2026-11-17 | curl |
| unroll me safe reddit               | 2026-11-17 | curl |
| unroll.me safety                    | 2026-11-17 | curl |
| unroll me safe to use               | 2026-11-17 | curl |

### Seed: "clean email app" (25 new unique; date 2026-11-17; tool curl)

Zero-suggestion modifiers: ' by sender', ' without', ' vs', ' alternative'

| Suggestion                                    | Date       | Tool |
| --------------------------------------------- | ---------- | ---- |
| clean email app                               | 2026-11-17 | curl |
| clean email app review                        | 2026-11-17 | curl |
| clean email app free                          | 2026-11-17 | curl |
| clean email app cost                          | 2026-11-17 | curl |
| clean email app reddit                        | 2026-11-17 | curl |
| clean email app download                      | 2026-11-17 | curl |
| clean email app store                         | 2026-11-17 | curl |
| clean email app iphone                        | 2026-11-17 | curl |
| clean email app safe                          | 2026-11-17 | curl |
| clean email app for gmail                     | 2026-11-17 | curl |
| how does clean email app work                 | 2026-11-17 | curl |
| how to clean email app                        | 2026-11-17 | curl |
| how to use clean email app                    | 2026-11-17 | curl |
| how much does clean email app cost            | 2026-11-17 | curl |
| clean email app reviews                       | 2026-11-17 | curl |
| how to clean email list (off-topic)           | 2026-11-17 | curl |
| how to clean email                            | 2026-11-17 | curl |
| delete email app from apple watch (off-topic) | 2026-11-17 | curl |
| clean email app free download                 | 2026-11-17 | curl |
| email delete app free                         | 2026-11-17 | curl |
| best email cleaning app free                  | 2026-11-17 | curl |
| clean email free                              | 2026-11-17 | curl |
| clean email cost                              | 2026-11-17 | curl |
| clean email safe                              | 2026-11-17 | curl |
| clean email review                            | 2026-11-17 | curl |

### Seed: "sanebox" (33 new unique; date 2026-11-17; tool curl)

Zero-suggestion modifiers: ' how', ' by sender', ' without'

| Suggestion                                  | Date       | Tool |
| ------------------------------------------- | ---------- | ---- |
| sanebox                                     | 2026-11-17 | curl |
| sanebox pricing                             | 2026-11-17 | curl |
| sanebox login                               | 2026-11-17 | curl |
| sanebox review                              | 2026-11-17 | curl |
| sanebox email                               | 2026-11-17 | curl |
| sanebox ai                                  | 2026-11-17 | curl |
| sanebox reddit                              | 2026-11-17 | curl |
| sandbox vr (off-topic)                      | 2026-11-17 | curl |
| sanebox alternatives                        | 2026-11-17 | curl |
| sandboxels (off-topic)                      | 2026-11-17 | curl |
| sanebox app                                 | 2026-11-17 | curl |
| sanebox apple mail                          | 2026-11-17 | curl |
| sanebox android app                         | 2026-11-17 | curl |
| sanebox free alternatives                   | 2026-11-17 | curl |
| sanebox free                                | 2026-11-17 | curl |
| sanebox free trial                          | 2026-11-17 | curl |
| sanebox cost                                | 2026-11-17 | curl |
| sanebox vs clean email                      | 2026-11-17 | curl |
| sanebox vs superhuman                       | 2026-11-17 | curl |
| sanebox vs fyxer                            | 2026-11-17 | curl |
| sanebox vs                                  | 2026-11-17 | curl |
| sanebox vs spark                            | 2026-11-17 | curl |
| sanebox vs mailstrom                        | 2026-11-17 | curl |
| sanebox vs shortwave                        | 2026-11-17 | curl |
| sanebox vs fyxer ai                         | 2026-11-17 | curl |
| sanebox vs copilot                          | 2026-11-17 | curl |
| vsp advantage vs choice (off-topic)         | 2026-11-17 | curl |
| sanebox alternatives reddit                 | 2026-11-17 | curl |
| alternates vs alternatives (off-topic)      | 2026-11-17 | curl |
| alternatives to accounting (off-topic)      | 2026-11-17 | curl |
| sanebox safe                                | 2026-11-17 | curl |
| is sanebox safe to use                      | 2026-11-17 | curl |
| safe and sound security reviews (off-topic) | 2026-11-17 | curl |

### Seed: "leave me alone email" (15 new unique; date 2026-11-17; tool curl)

Zero-suggestion modifiers: ' how', ' free', ' by sender', ' without', ' alternative', ' safe'

| Suggestion                                                    | Date       | Tool |
| ------------------------------------------------------------- | ---------- | ---- |
| leave me alone email cleaner                                  | 2026-11-17 | curl |
| leave me alone email                                          | 2026-11-17 | curl |
| leave me alone email unsubscribe                              | 2026-11-17 | curl |
| leave me alone email app                                      | 2026-11-17 | curl |
| leave me alone email reddit                                   | 2026-11-17 | curl |
| leave me alone email review                                   | 2026-11-17 | curl |
| leave me alone email tool                                     | 2026-11-17 | curl |
| leave me alone email spam                                     | 2026-11-17 | curl |
| leave me alone email service                                  | 2026-11-17 | curl |
| leave me alone email clean up                                 | 2026-11-17 | curl |
| how to apply leave in mail (off-topic)                        | 2026-11-17 | curl |
| why does my phone keep signing me out of my email (off-topic) | 2026-11-17 | curl |
| leave me alone vs clean email                                 | 2026-11-17 | curl |
| leave em alone meaning (off-topic)                            | 2026-11-17 | curl |
| whats another word for leave me alone (off-topic)             | 2026-11-17 | curl |

### Seed: "trimbox" (29 new unique; date 2026-11-17; tool curl)

Zero-suggestion modifiers: ' how', ' by sender', ' without'

| Suggestion                         | Date       | Tool |
| ---------------------------------- | ---------- | ---- |
| trimbox                            | 2026-11-17 | curl |
| trimbox reviews                    | 2026-11-17 | curl |
| trimbox login                      | 2026-11-17 | curl |
| trimbox cancel subscription        | 2026-11-17 | curl |
| trimbox app                        | 2026-11-17 | curl |
| trimbox cost                       | 2026-11-17 | curl |
| trimbox for gmail                  | 2026-11-17 | curl |
| trimbox email cleaner              | 2026-11-17 | curl |
| trimbox subscription               | 2026-11-17 | curl |
| trimbox extension                  | 2026-11-17 | curl |
| trimbox app review                 | 2026-11-17 | curl |
| is dramabox app safe (off-topic)   | 2026-11-17 | curl |
| trimbox app reddit                 | 2026-11-17 | curl |
| trimbox app cost                   | 2026-11-17 | curl |
| is trimbox app free                | 2026-11-17 | curl |
| trimbox free                       | 2026-11-17 | curl |
| trimbox free trial                 | 2026-11-17 | curl |
| is trimbox free on iphone          | 2026-11-17 | curl |
| trimbox cancel free trial          | 2026-11-17 | curl |
| clean email vs trimbox             | 2026-11-17 | curl |
| trimbox vs cropbox (off-topic)     | 2026-11-17 | curl |
| trimbox vs bleedbox (off-topic)    | 2026-11-17 | curl |
| pdf trimbox vs cropbox (off-topic) | 2026-11-17 | curl |
| trimbox alternative                | 2026-11-17 | curl |
| trimbox alternative free           | 2026-11-17 | curl |
| trimbox safe                       | 2026-11-17 | curl |
| is trimbox safe to use             | 2026-11-17 | curl |
| is trimbox safe for gmail          | 2026-11-17 | curl |
| is trimbox safe to use reddit      | 2026-11-17 | curl |

## B2. SERP top-5 per keyword

25 cleanup-relevant suggestions from B1, each searched once with WebSearch (standard mode) on 2026-11-17. Top 5 = first five links in the order returned (same-domain repeats kept, so overlap can be computed on URL or on domain). **declutrmail.com appeared in none of the 25.** The 14 Task A queries (section A) can be merged in for overlap; their first five rows are the top 5.

### B2.1 "gmail cleanup tool" (from seed "gmail cleanup")

| Rank | URL                                                            | Domain          | Date       | Tool                 |
| ---- | -------------------------------------------------------------- | --------------- | ---------- | -------------------- |
| 1    | https://sourceforge.net/projects/gmail-cleaner.mirror/         | sourceforge.net | 2026-11-17 | WebSearch (standard) |
| 2    | https://clean.email/clean-gmail-inbox/best-gmail-cleanup-tools | clean.email     | 2026-11-17 | WebSearch (standard) |
| 3    | https://sourceforge.net/mirror/gmail-cleaner                   | sourceforge.net | 2026-11-17 | WebSearch (standard) |
| 4    | https://www.notion.com/blog/gmail-cleaner-app                  | notion.com      | 2026-11-17 | WebSearch (standard) |
| 5    | https://clean.email/best-gmail-cleanup-tools                   | clean.email     | 2026-11-17 | WebSearch (standard) |

### B2.2 "gmail cleaner free" (from seed "gmail cleanup free")

| Rank | URL                                                                                             | Domain             | Date       | Tool                 |
| ---- | ----------------------------------------------------------------------------------------------- | ------------------ | ---------- | -------------------- |
| 1    | https://sourceforge.net/mirror/gmail-cleaner                                                    | sourceforge.net    | 2026-11-17 | WebSearch (standard) |
| 2    | https://sourceforge.net/projects/gmail-cleaner.mirror/                                          | sourceforge.net    | 2026-11-17 | WebSearch (standard) |
| 3    | https://addons.mozilla.org/addon/gmail-one-click-cleaner/                                       | addons.mozilla.org | 2026-11-17 | WebSearch (standard) |
| 4    | https://addons.mozilla.org/firefox/addon/gmail-one-click-cleaner@gmail-cleaner-pro.netlify.app/ | addons.mozilla.org | 2026-11-17 | WebSearch (standard) |
| 5    | https://www.producthunt.com/products/mailmop                                                    | producthunt.com    | 2026-11-17 | WebSearch (standard) |

### B2.3 "gmail cleanup extension" (from seed "gmail cleanup")

| Rank | URL                                                                                                                 | Domain             | Date       | Tool                 |
| ---- | ------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------- | -------------------- |
| 1    | https://addons.mozilla.org/tr/firefox/addon/cleanup-gmail/                                                          | addons.mozilla.org | 2026-11-17 | WebSearch (standard) |
| 2    | https://addons.mozilla.org/sl/firefox/addon/cleanup-gmail/                                                          | addons.mozilla.org | 2026-11-17 | WebSearch (standard) |
| 3    | https://chrome.google.com/webstore/detail/gmail-cleanup/dapfldihimbihndoeknipaiidpdlahbl                            | chrome.google.com  | 2026-11-17 | WebSearch (standard) |
| 4    | https://chrome.google.com/webstore/detail/unsubme/detail/gmail-bulk-unsubscribe-de/mogabgmejhmicinppdfeoaokolphbgcd | chrome.google.com  | 2026-11-17 | WebSearch (standard) |
| 5    | https://www.chromeboard.com/extension/bulk-delete-gmail-emails-bmcfpljakkpcbinhgiahncpcbhmihgpc                     | chromeboard.com    | 2026-11-17 | WebSearch (standard) |

### B2.4 "clean up gmail by sender" (from seed "gmail cleanup by sender")

| Rank | URL                                                                                     | Domain               | Date       | Tool                 |
| ---- | --------------------------------------------------------------------------------------- | -------------------- | ---------- | -------------------- |
| 1    | https://workspace.google.com/marketplace/app/adinand_email_cleaner/1003088359413?hl=he  | workspace.google.com | 2026-11-17 | WebSearch (standard) |
| 2    | https://workspace.google.com/marketplace/app/adinand_email_cleaner/1003088359413?hl=fil | workspace.google.com | 2026-11-17 | WebSearch (standard) |
| 3    | https://workspace.google.com/marketplace/app/adinand_email_cleaner/1003088359413?hl=fi  | workspace.google.com | 2026-11-17 | WebSearch (standard) |
| 4    | https://www.fyxer.com/blog/how-to-delete-all-emails-from-one-sender                     | fyxer.com            | 2026-11-17 | WebSearch (standard) |
| 5    | https://emailanalytics.com/clean-up-gmail/                                              | emailanalytics.com   | 2026-11-17 | WebSearch (standard) |

### B2.5 "clean up gmail storage" (from seed "clean up gmail")

| Rank | URL                                                                   | Domain         | Date       | Tool                 |
| ---- | --------------------------------------------------------------------- | -------------- | ---------- | -------------------- |
| 1    | https://clean.email/clean-gmail-inbox/how-to-clean-up-gmail-storage   | clean.email    | 2026-11-17 | WebSearch (standard) |
| 2    | https://mailmeteor.com/blog/gmail-clean-up                            | mailmeteor.com | 2026-11-17 | WebSearch (standard) |
| 3    | https://www.91mobiles.com/hub/clear-google-account-gmail-storage/     | 91mobiles.com  | 2026-11-17 | WebSearch (standard) |
| 4    | https://cleanmymac.com/blog/clean-up-gmail-storage                    | cleanmymac.com | 2026-11-17 | WebSearch (standard) |
| 5    | https://clean.email/clean-gmail-inbox/fixing-gmail-storage-full-issue | clean.email    | 2026-11-17 | WebSearch (standard) |

### B2.6 "how to clean up gmail without deleting important emails" (from seed "clean up gmail without")

| Rank | URL                                                                                                                      | Domain            | Date       | Tool                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------ | ----------------- | ---------- | -------------------- |
| 1    | https://mailmeteor.com/blog/gmail-clean-up                                                                               | mailmeteor.com    | 2026-11-17 | WebSearch (standard) |
| 2    | https://www.wral.com/how-to-delete-all-mail-in-gmail-or-other-email-services-without-losing-anything-important/19956334/ | wral.com          | 2026-11-17 | WebSearch (standard) |
| 3    | https://clickup.com/blog/how-to-clean-up-your-gmail-inbox/                                                               | clickup.com       | 2026-11-17 | WebSearch (standard) |
| 4    | https://www.systoolsgroup.com/how-to/clean-gmail-inbox-without-deleting                                                  | systoolsgroup.com | 2026-11-17 | WebSearch (standard) |
| 5    | https://www.kshb.com/how-delete-all-mail-gmail                                                                           | kshb.com          | 2026-11-17 | WebSearch (standard) |

### B2.7 "clean up gmail subscriptions" (from seed "clean up gmail")

| Rank | URL                                                                                                                                    | Domain             | Date       | Tool                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------- | -------------------- |
| 1    | https://mac.softpedia.com/get/Internet-Utilities/Cleanbox.shtml                                                                        | mac.softpedia.com  | 2026-11-17 | WebSearch (standard) |
| 2    | https://www.androidcentral.com/apps-software/android-os/android-users-can-declutter-their-inboxes-with-gmails-new-manage-subscriptions | androidcentral.com | 2026-11-17 | WebSearch (standard) |
| 3    | https://clean.email/clean-gmail-inbox/how-to-quickly-clean-up-gmail                                                                    | clean.email        | 2026-11-17 | WebSearch (standard) |
| 4    | https://www.techloy.com/how-to-unsubscribe-from-gmail-spam-subscriptions-in-4-easy-steps.md                                            | techloy.com        | 2026-11-17 | WebSearch (standard) |
| 5    | https://www.igeeksblog.com/clean-gmail-promotional-emails-in-minutes/                                                                  | igeeksblog.com     | 2026-11-17 | WebSearch (standard) |

### B2.8 "mass delete gmail emails by sender" (from seed "mass delete gmail")

| Rank | URL                                                                                                                            | Domain            | Date       | Tool                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ---------- | -------------------- |
| 1    | https://moosend.com/blog/mass-delete-emails-gmail/                                                                             | moosend.com       | 2026-11-17 | WebSearch (standard) |
| 2    | https://www.fyxer.com/blog/how-to-delete-all-emails-from-one-sender                                                            | fyxer.com         | 2026-11-17 | WebSearch (standard) |
| 3    | https://chromeunboxed.com/gmail-how-to-mass-delete-spam-promotions-more                                                        | chromeunboxed.com | 2026-11-17 | WebSearch (standard) |
| 4    | https://chromeunboxed.com/use-this-mass-deletion-trick-in-gmail-to-declutter-thousands-of-old-and-irrelevant-messages-at-once/ | chromeunboxed.com | 2026-11-17 | WebSearch (standard) |
| 5    | https://landing.fyxer.com/blog/how-to-delete-all-emails-from-one-sender                                                        | landing.fyxer.com | 2026-11-17 | WebSearch (standard) |

### B2.9 "delete emails gmail bulk" (from seed "delete emails gmail")

| Rank | URL                                                                                                                | Domain                | Date       | Tool                 |
| ---- | ------------------------------------------------------------------------------------------------------------------ | --------------------- | ---------- | -------------------- |
| 1    | https://teamdynamix.umich.edu/TDClient/30/Portal/KB/PrintArticle?ID=11495                                          | teamdynamix.umich.edu | 2026-11-17 | WebSearch (standard) |
| 2    | https://zapier.com/blog/how-to-mass-delete-emails-gmail.md                                                         | zapier.com            | 2026-11-17 | WebSearch (standard) |
| 3    | https://blog.superhuman.com/how-to-mass-delete-emails-gmail                                                        | blog.superhuman.com   | 2026-11-17 | WebSearch (standard) |
| 4    | https://teamdynamix.umich.edu/TDClient/30/Portal/KB/Article/11495/Google-How-Do-I-Bulk-Mass-Delete-Emails-in-Gmail | teamdynamix.umich.edu | 2026-11-17 | WebSearch (standard) |
| 5    | https://zapier.com/de/blog/how-to-mass-delete-emails-gmail/                                                        | zapier.com            | 2026-11-17 | WebSearch (standard) |

### B2.10 "gmail storage full but nothing to delete" (from seed "gmail storage full")

| Rank | URL                                                                              | Domain           | Date       | Tool                 |
| ---- | -------------------------------------------------------------------------------- | ---------------- | ---------- | -------------------- |
| 1    | https://filerev.com/blog/quota-exceeded-gmail-space/                             | filerev.com      | 2026-11-17 | WebSearch (standard) |
| 2    | https://filerev.com/quota-exceeded-gmail-space/                                  | filerev.com      | 2026-11-17 | WebSearch (standard) |
| 3    | https://www.getinboxzero.com/blog/post/why-is-gmail-storage-full-but-inbox-empty | getinboxzero.com | 2026-11-17 | WebSearch (standard) |
| 4    | https://www.picbackman.com/tips-tricks/fixed-gmail-storage-full-but-it-s-not/    | picbackman.com   | 2026-11-17 | WebSearch (standard) |
| 5    | https://mailmeteor.com/blog/gmail-storage-full                                   | mailmeteor.com   | 2026-11-17 | WebSearch (standard) |

### B2.11 "mass unsubscribe gmail free" (from seed "unsubscribe gmail free")

| Rank | URL                                                                              | Domain             | Date       | Tool                 |
| ---- | -------------------------------------------------------------------------------- | ------------------ | ---------- | -------------------- |
| 1    | https://addons.mozilla.org/addon/gmail-mass-unsubscriber/                        | addons.mozilla.org | 2026-11-17 | WebSearch (standard) |
| 2    | https://addons.mozilla.org/firefox/addon/gmail-mass-unsubscriber/                | addons.mozilla.org | 2026-11-17 | WebSearch (standard) |
| 3    | https://www.slashgear.com/1853804/best-tools-unsubscribe-unwanted-spam-emails    | slashgear.com      | 2026-11-17 | WebSearch (standard) |
| 4    | https://hackernoon.com/a-beginners-guide-to-mass-unsubscribing-on-gmail          | hackernoon.com     | 2026-11-17 | WebSearch (standard) |
| 5    | https://hackernoon.com/lang/id/a-beginner's-guide-to-mass-unsubscribing-on-gmail | hackernoon.com     | 2026-11-17 | WebSearch (standard) |

### B2.12 "is gmail unsubscribe safe" (from seed "unsubscribe gmail free / safe")

| Rank | URL                                                                                                                                                   | Domain           | Date       | Tool                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------- | -------------------- |
| 1    | https://dmarcreport.com/blog/is-it-safe-to-unsubscribe-from-spam-emails/                                                                              | dmarcreport.com  | 2026-11-17 | WebSearch (standard) |
| 2    | https://us.norton.com/internetsecurity-online-scams-is-it-safe-to-click-on-unsubscribe-links.html                                                     | us.norton.com    | 2026-11-17 | WebSearch (standard) |
| 3    | https://dmarcreport.com/blog/is-it-safe-to-unsubscribe-from-spam-emails.md                                                                            | dmarcreport.com  | 2026-11-17 | WebSearch (standard) |
| 4    | https://www.spamresource.com/2025/07/its-actually-usually-safe-to-unsubscribe.html                                                                    | spamresource.com | 2026-11-17 | WebSearch (standard) |
| 5    | https://www.businesstoday.in/technology/news/story/gmail-unscubscribe-scam-clicking-unsubscribe-in-emails-could-get-put-you-at-risk-480505-2025-06-16 | businesstoday.in | 2026-11-17 | WebSearch (standard) |

### B2.13 "gmail unsubscribe not working" (from seed "unsubscribe gmail without")

| Rank | URL                                                                                                                                                         | Domain                                     | Date       | Tool                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------- | -------------------- |
| 1    | https://experienceleaguecommunities.adobe.com/adobe-marketo-engage-27/gmail-unsubscribe-links-inconsistency-in-gmail-app-183832                             | experienceleaguecommunities.adobe.com      | 2026-11-17 | WebSearch (standard) |
| 2    | https://experienceleaguecommunities-beta.adobe.com/marketo-27/gmail-unsubscribe-links-inconsistency-in-gmail-app-183832                                     | experienceleaguecommunities-beta.adobe.com | 2026-11-17 | WebSearch (standard) |
| 3    | https://github.com/knadh/listmonk/issues/1655                                                                                                               | github.com                                 | 2026-11-17 | WebSearch (standard) |
| 4    | https://www.suped.com/email-deliverability/answers/why-do-i-still-receive-emails-after-unsubscribing-through-gmails-unsubscribe-button                      | suped.com                                  | 2026-11-17 | WebSearch (standard) |
| 5    | https://experienceleaguecommunities.adobe.com/t5/adobe-campaign-classic-questions/alternate-way-for-implementation-of-one-click-list-unsubscribe/m-p/666274 | experienceleaguecommunities.adobe.com      | 2026-11-17 | WebSearch (standard) |

### B2.14 "gmail sort by sender with most emails" (from seed "gmail sort by sender")

| Rank | URL                                                                                                                                                  | Domain                | Date       | Tool                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------- | -------------------- |
| 1    | https://businessinsider.nl/how-to-sort-by-sender-and-more-in-gmail-to-find-your-most-important-messages                                              | businessinsider.nl    | 2026-11-17 | WebSearch (standard) |
| 2    | https://www.businessinsider.in/tech/how-to/how-to-sort-by-sender-and-more-in-gmail-to-find-your-most-important-messages/articleshow/86081739.cms     | businessinsider.in    | 2026-11-17 | WebSearch (standard) |
| 3    | https://www.businessinsider.in/tech/how-to/how-to-sort-by-sender-and-more-in-gmail-to-find-your-most-important-messages/amp_articleshow/86081739.cms | businessinsider.in    | 2026-11-17 | WebSearch (standard) |
| 4    | https://discussions.apple.com/thread/255617292                                                                                                       | discussions.apple.com | 2026-11-17 | WebSearch (standard) |
| 5    | https://www.producthunt.com/products/gmail-mbox-stats/alternatives                                                                                   | producthunt.com       | 2026-11-17 | WebSearch (standard) |

### B2.15 "gmail auto archive from sender" (from seed "gmail auto archive")

| Rank | URL                                                                                                       | Domain               | Date       | Tool                 |
| ---- | --------------------------------------------------------------------------------------------------------- | -------------------- | ---------- | -------------------- |
| 1    | https://lifetips.alibaba.com/tech-efficiency/gmail-auto-archive-by-sender-keyword                         | lifetips.alibaba.com | 2026-11-17 | WebSearch (standard) |
| 2    | https://www.picbackman.com/tips-tricks/how-to-automatically-archive-emails-in-gmail-a-step-by-step-guide/ | picbackman.com       | 2026-11-17 | WebSearch (standard) |
| 3    | https://www.technipages.com/how-to-automatically-archive-emails-in-gmail/                                 | technipages.com      | 2026-11-17 | WebSearch (standard) |
| 4    | https://www.multcloud.com/tutorials/automatically-archive-emails-gmail-0121.amp.html                      | multcloud.com        | 2026-11-17 | WebSearch (standard) |
| 5    | https://help.superhuman.com/hc/en-us/articles/40127823829267                                              | help.superhuman.com  | 2026-11-17 | WebSearch (standard) |

### B2.16 "gmail auto archive after 30 days" (from seed "gmail auto archive")

| Rank | URL                                                                                         | Domain              | Date       | Tool                 |
| ---- | ------------------------------------------------------------------------------------------- | ------------------- | ---------- | -------------------- |
| 1    | https://www.growwstacks.com/workflows/daily-auto-archive-for-gmail-messages                 | growwstacks.com     | 2026-11-17 | WebSearch (standard) |
| 2    | https://www.multcloud.com/tutorials/automatically-archive-emails-gmail-0121.amp.html        | multcloud.com       | 2026-11-17 | WebSearch (standard) |
| 3    | https://www.getinboxzero.com/blog/post/automatically-delete-emails-older-than-30-days-gmail | getinboxzero.com    | 2026-11-17 | WebSearch (standard) |
| 4    | https://multcloud.com/tutorials/automatically-archive-emails-gmail-0121.html                | multcloud.com       | 2026-11-17 | WebSearch (standard) |
| 5    | https://bulldo-gs.pages.dev/auto-archive-old-emails-in-google-sheets/                       | bulldo-gs.pages.dev | 2026-11-17 | WebSearch (standard) |

### B2.17 "gmail filter apply to existing mail" (from seed "gmail filter app")

| Rank | URL                                                                                                   | Domain              | Date       | Tool                 |
| ---- | ----------------------------------------------------------------------------------------------------- | ------------------- | ---------- | -------------------- |
| 1    | https://blog.primowater.com/?p=46121                                                                  | blog.primowater.com | 2026-11-17 | WebSearch (standard) |
| 2    | https://truehost.com/apply-a-filter-to-existing-mail-in-gmail/                                        | truehost.com        | 2026-11-17 | WebSearch (standard) |
| 3    | https://truehost.com/?p=5133                                                                          | truehost.com        | 2026-11-17 | WebSearch (standard) |
| 4    | https://office.mailbox.org/appsuite/help/l10n/en_GB/ox.appsuite.user.sect.email.mailfilter.apply.html | office.mailbox.org  | 2026-11-17 | WebSearch (standard) |
| 5    | https://ecolighting.uk.com/?p=69180                                                                   | ecolighting.uk.com  | 2026-11-17 | WebSearch (standard) |

### B2.18 "unroll me vs clean email" (from seed "unroll.me vs")

| Rank | URL                                                              | Domain           | Date       | Tool                 |
| ---- | ---------------------------------------------------------------- | ---------------- | ---------- | -------------------- |
| 1    | https://leavemealone.com/blog/unroll-me-vs-clean-email/amp/      | leavemealone.com | 2026-11-17 | WebSearch (standard) |
| 2    | https://leavemealone.com/blog/unroll-me-vs-clean-email/          | leavemealone.com | 2026-11-17 | WebSearch (standard) |
| 3    | https://www.g2.com/compare/clean-email-vs-unroll-me              | g2.com           | 2026-11-17 | WebSearch (standard) |
| 4    | https://www.g2.com/compare/clean-email-vs-unroll-me-vs-mailstrom | g2.com           | 2026-11-17 | WebSearch (standard) |
| 5    | https://www.g2.com/compare/clean-email-vs-unroll-me-vs-sanebox   | g2.com           | 2026-11-17 | WebSearch (standard) |

### B2.19 "unroll me alternative reddit" (from seed "unroll.me alternative")

| Rank | URL                                                          | Domain                        | Date       | Tool                 |
| ---- | ------------------------------------------------------------ | ----------------------------- | ---------- | -------------------- |
| 1    | https://leavemealone.com/blog/alt-unrollme-tools/amp/        | leavemealone.com              | 2026-11-17 | WebSearch (standard) |
| 2    | https://leavemealone.com/blog/alt-unrollme-tools/            | leavemealone.com              | 2026-11-17 | WebSearch (standard) |
| 3    | https://usedigest-marketing.pages.dev/alternatives/unroll-me | usedigest-marketing.pages.dev | 2026-11-17 | WebSearch (standard) |
| 4    | https://alternativeto.net/software/unroll-me/?p=2            | alternativeto.net             | 2026-11-17 | WebSearch (standard) |
| 5    | https://alternativeto.net/software/unroll-me/?p=4            | alternativeto.net             | 2026-11-17 | WebSearch (standard) |

### B2.20 "sanebox vs clean email" (from seed "sanebox vs")

| Rank | URL                                                       | Domain          | Date       | Tool                 |
| ---- | --------------------------------------------------------- | --------------- | ---------- | -------------------- |
| 1    | https://www.jotform.com/ai/agents/sanebox-vs-clean-email/ | jotform.com     | 2026-11-17 | WebSearch (standard) |
| 2    | https://www.g2.com/compare/clean-email-vs-sanebox         | g2.com          | 2026-11-17 | WebSearch (standard) |
| 3    | https://dhruvirzala.com/sanebox-vs-clean-email/           | dhruvirzala.com | 2026-11-17 | WebSearch (standard) |
| 4    | https://clean.email/es/best-sanebox-alternative           | clean.email     | 2026-11-17 | WebSearch (standard) |
| 5    | https://dhruvirzala.com/?p=7498                           | dhruvirzala.com | 2026-11-17 | WebSearch (standard) |

### B2.21 "clean email app review" (from seed "clean email app")

| Rank | URL                                                  | Domain                 | Date       | Tool                 |
| ---- | ---------------------------------------------------- | ---------------------- | ---------- | -------------------- |
| 1    | https://thebusinessdive.com/clean-email-review       | thebusinessdive.com    | 2026-11-17 | WebSearch (standard) |
| 2    | https://thebusinessdive.com/?p=18235                 | thebusinessdive.com    | 2026-11-17 | WebSearch (standard) |
| 3    | https://www.capterra.com/p/178247/CleanEmail/reviews | capterra.com           | 2026-11-17 | WebSearch (standard) |
| 4    | https://www.capterra.com/p/178247/CleanEmail/        | capterra.com           | 2026-11-17 | WebSearch (standard) |
| 5    | https://strongtestimonials.com/clean-email-review/   | strongtestimonials.com | 2026-11-17 | WebSearch (standard) |

### B2.22 "leave me alone vs clean email" (from seed "leave me alone email vs")

| Rank | URL                                                                                  | Domain          | Date       | Tool                 |
| ---- | ------------------------------------------------------------------------------------ | --------------- | ---------- | -------------------- |
| 1    | https://clean.email/es/blog/clean-email-alternatives/best-leave-me-alone-alternative | clean.email     | 2026-11-17 | WebSearch (standard) |
| 2    | https://clean.email/de/blog/clean-email-alternatives/best-leave-me-alone-alternative | clean.email     | 2026-11-17 | WebSearch (standard) |
| 3    | https://clean.email/fr/blog/clean-email-alternatives/best-leave-me-alone-alternative | clean.email     | 2026-11-17 | WebSearch (standard) |
| 4    | https://clean.email/blog/clean-email-alternatives/best-leave-me-alone-alternative    | clean.email     | 2026-11-17 | WebSearch (standard) |
| 5    | https://againstdata.com/blog/leave-me-alone-alternatives                             | againstdata.com | 2026-11-17 | WebSearch (standard) |

### B2.23 "is trimbox safe for gmail" (from seed "trimbox safe")

| Rank | URL                                                                                                      | Domain                 | Date       | Tool                 |
| ---- | -------------------------------------------------------------------------------------------------------- | ---------------------- | ---------- | -------------------- |
| 1    | https://clean.email/de/blog/clean-email-alternatives/best-trimbox-alternative                            | clean.email            | 2026-11-17 | WebSearch (standard) |
| 2    | https://clean.email/blog/clean-email-alternatives/best-trimbox-alternative                               | clean.email            | 2026-11-17 | WebSearch (standard) |
| 3    | https://clean.email/fr/blog/clean-email-alternatives/best-trimbox-alternative                            | clean.email            | 2026-11-17 | WebSearch (standard) |
| 4    | https://trimboxapp.notion.site/Why-isn-t-Trimbox-showing-up-in-my-Gmail-f77400d2352442baabe92f8f2e0e74d4 | trimboxapp.notion.site | 2026-11-17 | WebSearch (standard) |
| 5    | https://gridinsoft.com/online-virus-scanner/url/web-trimbox-io                                           | gridinsoft.com         | 2026-11-17 | WebSearch (standard) |

### B2.24 "gmail cleaner app reddit" (from seed "gmail cleanup app")

| Rank | URL                                                                               | Domain               | Date       | Tool                 |
| ---- | --------------------------------------------------------------------------------- | -------------------- | ---------- | -------------------- |
| 1    | https://www.producthunt.com/products/mult-cleaner/alternatives                    | producthunt.com      | 2026-11-17 | WebSearch (standard) |
| 2    | https://workspace.google.com/marketplace/app/cleaner_for_gmail/175823175354       | workspace.google.com | 2026-11-17 | WebSearch (standard) |
| 3    | https://www.producthunt.com/products/mult-cleaner/reviews?page=2                  | producthunt.com      | 2026-11-17 | WebSearch (standard) |
| 4    | https://workspace.google.com/marketplace/app/cleaner_for_gmail/175823175354?hl=de | workspace.google.com | 2026-11-17 | WebSearch (standard) |
| 5    | https://www.producthunt.com/products/mailmop                                      | producthunt.com      | 2026-11-17 | WebSearch (standard) |

### B2.25 "mass delete gmail promotion emails" (from seed "mass delete gmail")

| Rank | URL                                                               | Domain              | Date       | Tool                 |
| ---- | ----------------------------------------------------------------- | ------------------- | ---------- | -------------------- |
| 1    | https://benzinga.com/z/34070823                                   | benzinga.com        | 2026-11-17 | WebSearch (standard) |
| 2    | https://infopackets.com/node/10567                                | infopackets.com     | 2026-11-17 | WebSearch (standard) |
| 3    | https://www.notion.com/blog/how-to-delete-all-promotions-in-gmail | notion.com          | 2026-11-17 | WebSearch (standard) |
| 4    | https://edisonmail.com/how-to-mass-delete-emails-on-gmail         | edisonmail.com      | 2026-11-17 | WebSearch (standard) |
| 5    | https://blog.superhuman.com/how-to-mass-delete-emails-gmail       | blog.superhuman.com | 2026-11-17 | WebSearch (standard) |

### B2 domain frequency (computed from the 25 tables above)

| Domain               | Keywords with domain in top 5 (of 25) | Total top-5 slots (of 125) | Date       | Tool                   |
| -------------------- | ------------------------------------- | -------------------------- | ---------- | ---------------------- |
| clean.email          | 6                                     | 13                         | 2026-11-17 | derived from WebSearch |
| addons.mozilla.org   | 3                                     | 6                          | 2026-11-17 | derived from WebSearch |
| producthunt.com      | 3                                     | 5                          | 2026-11-17 | derived from WebSearch |
| mailmeteor.com       | 3                                     | 3                          | 2026-11-17 | derived from WebSearch |
| workspace.google.com | 2                                     | 5                          | 2026-11-17 | derived from WebSearch |
| g2.com               | 2                                     | 4                          | 2026-11-17 | derived from WebSearch |
| leavemealone.com     | 2                                     | 4                          | 2026-11-17 | derived from WebSearch |
| sourceforge.net      | 2                                     | 4                          | 2026-11-17 | derived from WebSearch |
| multcloud.com        | 2                                     | 3                          | 2026-11-17 | derived from WebSearch |
| blog.superhuman.com  | 2                                     | 2                          | 2026-11-17 | derived from WebSearch |
| fyxer.com            | 2                                     | 2                          | 2026-11-17 | derived from WebSearch |
| getinboxzero.com     | 2                                     | 2                          | 2026-11-17 | derived from WebSearch |
| notion.com           | 2                                     | 2                          | 2026-11-17 | derived from WebSearch |
| picbackman.com       | 2                                     | 2                          | 2026-11-17 | derived from WebSearch |

Domains in exactly one keyword's top 5: 54. declutrmail.com: 0 of 25.

### B2 keyword pairs sharing at least one top-5 URL

| Keyword A                      | Keyword B                                               | Shared URLs | Date       | Tool                   |
| ------------------------------ | ------------------------------------------------------- | ----------- | ---------- | ---------------------- |
| gmail cleanup tool             | gmail cleaner free                                      | 2           | 2026-11-17 | derived from WebSearch |
| gmail cleaner free             | gmail cleaner app reddit                                | 1           | 2026-11-17 | derived from WebSearch |
| clean up gmail by sender       | mass delete gmail emails by sender                      | 1           | 2026-11-17 | derived from WebSearch |
| clean up gmail storage         | how to clean up gmail without deleting important emails | 1           | 2026-11-17 | derived from WebSearch |
| delete emails gmail bulk       | mass delete gmail promotion emails                      | 1           | 2026-11-17 | derived from WebSearch |
| gmail auto archive from sender | gmail auto archive after 30 days                        | 1           | 2026-11-17 | derived from WebSearch |
