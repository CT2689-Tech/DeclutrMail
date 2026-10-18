# Timer metadata must not invent a standing decision

**Observed:** Later → Undo on a sender with no policy row restored Gmail and counts but left “Skipped in Triage”. A timer insert inherited `policy_type=keep`; existing lifecycle tests had seeded policy rows, hiding the fresh-row path. Keep Undo also deleted independent timer metadata, and a paused background Keep upsert could reinstate an undone choice.

**Repair:** Allow a neutral standing verdict; explicitly use it in timer-only inserts and preserve existing decisions on conflict. Keep Undo clears the decision without dropping timer/modifier data. Undo and delayed projection serialize their audit read and write using the same bounded mailbox transaction lock, including when no row exists.

**Enforcement:** Test no policy, neutral timer, genuine Keep and accepted Unsubscribe through real forward/reverse work and actual readers. Pin explicit Keep after neutral and a subsequent Keep after Undo. Reproduce background projection interleaving against real Postgres, including the absent-row case; a policy row lock alone cannot protect a row that does not exist yet. Historical default Keep rows remain ambiguous and are not bulk rewritten.
