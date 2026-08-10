# CourtFlow — Architecture

## The question

> What happens when two agents disagree about whether a promise was fulfilled?

CourtFlow answers it by turning a commerce agreement into a **contested commitment**
that GenLayer's decentralized AI-validator consensus can adjudicate, and by making
the resulting judgment settle escrow automatically and deterministically.

## System components

```
Next.js Frontend  (frontend/)
        │  genlayer-js, injected wallet (MetaMask/Rabby/etc.)
        ▼
GenLayer Chain (EVM-compatible L2)
        │
        ▼
GenVM  ── executes the Intelligent Contract
        │
        ▼
Intelligent Contract  (contracts/courtflow.py)
   ├─ Agreement state machine
   ├─ Escrow ledger (custody)
   ├─ Delivery / dispute records
   ├─ Evidence references (hashes only)
   ├─ Judgment pipeline (gl.nondet.exec_prompt + gl.eq_principle.prompt_non_comparative)
   └─ Settlement (single payout helper, deterministic bps mapping)
        │
        ▼
Reputation (derived from finalized settlements only)
```

There is **no custom backend**. The frontend talks directly to the Intelligent
Contract via `genlayer-js`. If a deliverable is a large file (a logo PNG/SVG/source),
the frontend uploads it to external storage and the contract only ever stores a
verifiable hash/reference — the contract remains the source of truth for
adjudication state, never for file bytes.

## Why GenLayer specifically

A conventional EVM contract cannot decide "does this logo contain copyrighted
material?" — that requires judgment, not just state transitions. GenLayer's
Optimistic Democracy lets the Intelligent Contract call an LLM (`gl.nondet.exec_prompt`)
as part of consensus, with validators re-checking the leader's output against an
explicit equivalence principle (`gl.eq_principle.prompt_non_comparative`) rather than
trusting one node's opinion. That is the trustless judgment layer CourtFlow needs.

## Separation of concerns (mandatory, see docs/adjudication-model.md)

1. **Judgment ≠ settlement.** The LLM/validator layer only ever produces a normalized,
   schema-validated `Judgment` (decision, payout_bps, reason_codes, summary). It never
   calls a transfer function directly.
   Deterministic contract code maps that judgment to a bps split and calls the single
   payout helper `_send_gen`.
2. **Evidence ≠ truth.** Evidence (claims, deliverable hashes, timestamps, brand
   guidelines, external URLs) is assembled into a structured case; the judgment is an
   evaluation of that case, not an assumption that any single party's claim is correct.
3. **Escrow custody ≠ agreement terms.** `agreed_amount` (what the parties agreed to)
   and `escrow_deposited` (what is actually in custody) are separate fields. Payout
   math reads only `escrow_deposited`.

## Data flow — end to end

```
Agreement created (DRAFT)
   → Provider accepts (ACTIVE)
   → Buyer funds escrow via @gl.public.write.payable (FUNDED)
   → Provider delivers (DELIVERED)
   → Buyer approves → settle in full (SETTLED)
        or
   → Buyer disputes (DISPUTED)
        → Evidence package assembled (UNDER_REVIEW)
        → GenLayer judgment via consensus (JUDGED: FULFILLED | FAILED | PARTIAL | INSUFFICIENT_EVIDENCE)
        → Deterministic settlement per payout_bps (SETTLED)
   → Reputation updated exactly once, only on finalized settlement
```

## Frontend

Next.js + TypeScript + Tailwind + shadcn/ui + genlayer-js. No custom server. Wallet
connection is via an injected provider (MetaMask/Rabby-style) — `genlayer-js`'s
`createClient({ chain, account })` is given the connected address, and the injected
provider performs signing; we do not generate or store private keys in the app.
