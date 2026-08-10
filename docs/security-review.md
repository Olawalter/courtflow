# CourtFlow — Security Review

Pass performed against `contracts/courtflow.py`, checked against the categories in
the master build spec (escrow, agreement, dispute, judgment, reputation). Findings
below; two led to real fixes, the rest are checked-and-clear.

## Findings

### 1. Stuck funds: no recovery if the buyer goes silent after delivery — FIXED

**Before:** once an agreement reached `DELIVERED`, the only paths forward were
`approve_delivery` (buyer) or `open_dispute` (buyer). If the buyer simply never
acted — no approval, no dispute, ever — the escrow had no legal exit. The contract
already had a symmetric protection for the *other* direction (`claim_timeout`,
letting the buyer reclaim funds if the provider never delivers), but nothing
protected the provider from an unresponsive buyer post-delivery.

**Fix:** added `claim_delivery_timeout` — the provider can claim the full escrow if
the buyer neither approves nor disputes before `dispute_window_seconds` elapses
after delivery. Symmetric to `claim_timeout`, same settlement ordering, same
double-spend guard (requires `DELIVERED` status, which a dispute or approval both
move away from). Tested in `tests/direct/test_settlement.py`
(`test_claim_delivery_timeout_*`, 5 tests) including that opening a dispute
correctly blocks this path (the dispute takes over as the resolution mechanism).

### 2. Judgment/settlement ordering left a theoretical stuck-state window — FIXED

**Before:** `run_judgment` wrote `self.judgments[dispute_id]`, flipped
`dispute.status` to `JUDGED`, *then* called `_settle_from_judgment`. If settlement
had ever raised after those writes (e.g. a future edit introduces a reachable
failure in the internal split-consistency check), the dispute would be stuck:
`dispute.status` no longer `UNDER_REVIEW` and `dispute_id` already in
`self.judgments`, so `run_judgment`'s own guards would block any retry — funds
stuck in `UNDER_REVIEW`-adjacent limbo with no way back.

Currently this exact path is unreachable in practice (the bps math in
`_parse_and_validate_judgment` guarantees `provider_amount + buyer_amount ==
deposited`), so this was a **fragility**, not an exploitable bug today — but it's
exactly the kind of ordering mistake that turns into a real incident after an
unrelated future change.

**Fix:** reordered so `_settle_from_judgment` runs first; `judgments[dispute_id]`
and `dispute.status` are only written after settlement succeeds. A failure now
leaves the dispute retryable instead of stuck.

## Checked, no issue found

- **Double settlement / re-entrancy** — `_settle` requires `escrow_deposited != 0`
  and zeroes it before any transfer (verified: `test_approve_delivery_cannot_double_settle`,
  `test_claim_timeout_cannot_double_settle`, `test_claim_delivery_timeout_cannot_double_settle`,
  `test_settlement_mapping_cannot_double_settle` all pass).
- **Zero-value transfers** — `_send_gen` no-ops on `amount == 0` rather than calling
  `emit_transfer` (which would raise on a zero value per the GenLayer docs).
- **Payout math / dust** — `provider_amount + buyer_amount` always equals
  `escrow_deposited` exactly (buyer gets the floor-division remainder); `_settle`
  double-checks this invariant explicitly.
- **Unauthorized access** — every write checks `gl.message.sender_address` against
  the specific party authorized for that action; covered by dedicated
  access-control tests per method.
- **Invalid state transitions** — centralized through `_require_status`, no method
  bypasses it.
- **LLM output trust** — `_parse_and_validate_judgment` never lets LLM-controlled
  `payout_bps` reach `_send_gen` for non-`PARTIAL` decisions; the contract
  overrides to the canonical 0/10000 regardless of what the model returned.
- **Reputation manipulation** — no public method sets reputation fields directly;
  only reachable through the settlement paths, each single-shot.
- **Evidence mutation** — `claim`/`provider_response` are write-once (no update
  method exists once set).

## Minor, non-exploitable notes (not fixed — self-limiting, don't affect other parties)

- `create_agreement` doesn't range-check `dispute_window_seconds` (a buyer could
  set it to `0`, disabling their own ability to ever dispute — self-inflicted only).
- `open_dispute`'s `dispute_id` isn't contractually required to equal
  `agreement_id` (the frontend enforces this convention, not the contract). Not
  exploitable for fund theft — `open_dispute` is still gated on the agreement being
  in `DELIVERED`, so a second dispute against the same agreement is blocked
  regardless of what `dispute_id` string is chosen.
