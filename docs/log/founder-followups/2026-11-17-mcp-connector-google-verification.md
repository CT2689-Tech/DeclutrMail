### 2026-11-17 — Check whether the MCP connector changes our Google OAuth verification

**Source:** session — MCP connector spec (`docs/spec/mcp-connector.md`, ADR-0048)
**Why:** The connector sends Gmail-derived fields (sender identity, subject lines, dates) to an AI assistant the user picks. Google's Workspace User Data and Developer Policy (read 2026-11-17) names MCPs, allows transfers only for user-facing features with consent, requires per-invocation confirmation of agentic actions, and requires prompt-injection protection. Whether this needs an updated use-case description, a re-review, or a CASA reassessment is unknown — nothing read so far answers it.
**How:** Google Cloud console → Google Auth Platform → Verification Center for the production project; compare the approved use-case and data-use description against ADR-0048. If unclear, ask through the verification support thread. Do this before the directory listing goes live; building can start before the answer.
**Verifies by:** A written answer from Google (or the console showing no change required), linked from this entry.
**Status:** Skipped — founder decision 2026-11-20: launch without asking Google; /privacy §4 updated in this PR
