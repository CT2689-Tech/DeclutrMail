# Marketing drafts, November 2026

Written 2026-11-18. **Drafts only.** Nothing has been posted, sent, submitted or signed up for. Every item goes out by the founder's hand, after review.

| File | What it is | Founder's job |
| --- | --- | --- |
| [video-scripts.md](video-scripts.md) | Three 60–120 s screen-recording scripts: mass delete, delete all from one sender, mass unsubscribe. Each has a title, YouTube description, hook, shot list and end card, plus a recording checklist. | Walk each Gmail step on a test account. Check every **[SCREEN CHECK]** label in the app. Record, review, then upload. |
| [reddit-answers.md](reddit-answers.md) | Ten answers to recurring questions, each with Reddit search queries. Gmail's method comes first. DeclutrMail appears in four, once each, with a disclosure. Posting rules are at the top. | Find a fresh thread, read the sub's rules, reword the answer for that thread, then post. Log it in the outreach playbook §6. |
| [outreach-emails.md](outreach-emails.md) | One pitch per target, with the contact route, date checked, the page it ties to, and a send / hold / do-not-send verdict. | Re-read each contact page and article on the day, then send the "Send" ones. Resolve the "Hold" ones in a browser first. |

## Where the facts come from

- **Product:** `apps/web/src/features/marketing/llms/llms-source.ts`, `packages/shared/src/copy/privacy.ts`, `packages/shared/src/entitlements/pricing.config.ts`.
- **Gmail steps:** the guide text in `apps/web/src/features/marketing/learn/how-to-content.ts`, which cites Google Help.
- **Targets and questions:** a November 2026 Similarweb snapshot kept locally, not in the repo (licensed data). That is panel data. It shows where to look, and it is never a source for a published claim.
- **Rules:** the outreach playbook and search-visibility plan (kept locally, not yet in the repo), and CLAUDE.md §2.0, §2.1, §2.2, §2.4 and §8.

Facts used in the drafts:

- Groups Gmail by sender.
- Five decisions: Keep, Archive, Unsubscribe, Later, Delete.
- A preview with the count before anything moves.
- Archive, Later and Delete can be undone from Activity for 30 days, on every plan.
- A sent unsubscribe request cannot be taken back.
- "We never fetch or store full email contents." Verbatim, never shortened.
- One Gmail permission, gmail.modify, which is broader than what DeclutrMail uses.
- DeclutrMail does not select by Gmail category, date or unread state. Gmail search is the tool there.

**Pricing is deliberately left out** of every draft except one mention that a Free plan exists. Per `pricing.config.ts` (founder decision 4A, 2026-11-17): Free clears 1,000 emails per signup month, counting only Archive and Delete. Plus is $59 a year. The Backlog Pass is $19 once, for 30 days of Plus. Pro is waitlist only. Quote prices only after re-reading https://declutrmail.com/pricing.md that day.

## Placeholders to fill

- [ ] `[PUBLIC NAME]`: every pitch signature and any video voice credit. Blocked on the founder's name decision.
- [ ] `[DATE CHECKED]`: each YouTube description, the date you walked the Gmail steps.
- [ ] `[ARCHIVE GUIDE URL]`: Reddit answer 8, once the archived-email guide is live.
- [ ] `[RECOVER GUIDE URL]`: Reddit answer 9, once the recover guide is live.
- [ ] `[ARTICLE URL, confirmed]` and the bracketed sentence: TechRepublic draft, after reading the article.
- [ ] **[SCREEN CHECK]** labels in the video scripts: "Clean up", sender inspector, How far back, Include archived email, the multi-select control, the Unsubscribe preview.
- [ ] Links marked "(live after the guides PR merges)": mass-delete, delete-more-than-50, delete-all-promotions and delete-all-unread guides. Do not publish those links before the merge.

## Before anything goes out

1. Re-read the live pricing page if any sentence touches price or limits.
2. Open every cited third-party page again. Drop any sentence the page no longer supports.
3. Disclosure on every product mention: "I make DeclutrMail."
4. Run the "Never" list: "AI reads your email", user counts, testimonials, "trusted by", "most private", "risk-free", "everything is reversible", "honest", category prediction, "Screen" as a verb, and any claim about a competitor.
