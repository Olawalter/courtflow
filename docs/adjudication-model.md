# CourtFlow — Adjudication Model

## Inputs: the evidence package

Assembled deterministically by the contract from stored state — not free-form user
text — into a single JSON case object before any LLM call:

```json
{
  "agreement": { "terms": "...", "agreed_amount": 500, "deadline": "...", "escrow_deposited": 500 },
  "buyer_claim": "...",
  "provider_response": "...",
  "deliverable": { "file_refs": ["ipfs://...png", "ipfs://...svg", "ipfs://...source"], "submitted_at": "..." },
  "delivery_deadline_met": true,
  "delivery_url_reachability_check": "not checked (no http/https file reference present)",
  "dispute_window_expiry": "..."
}
```

Evidence is not truth: the contract never assumes the buyer's claim or the
provider's response is correct — both are inputs to the judgment, not conclusions.

### Live web data: the delivery reachability check

The MVP case (is this logo original artwork?) is genuinely an evidentiary judgment
call, not a fact a web lookup alone resolves — there's no authoritative "is this
copyrighted" API, and both parties' text submissions are the actual evidence for
that question. But one part of the case *is* independently checkable: whether a
delivered file reference actually resolves, rather than just being a string the
provider typed in. `run_judgment` verifies that.

GenLayer's non-determinism isn't limited to text reasoning — the official
`FootballBets` example contract (in the standard boilerplate) fetches a live scores
page via `gl.nondet.web.get`/`.render` and feeds it into the same kind of
equivalence-principle check used for judgment here, for exactly the class of dispute
where an authoritative external source exists. CourtFlow's contract follows the same
pattern: `_verify_delivery_reachability` (in `contracts/courtflow.py`) calls
`gl.nondet.web.head(url)` on the first `http(s)://` delivery reference and reports
whether it resolved. It's called from inside the `leader_input` closure passed to
`gl.eq_principle.prompt_non_comparative` — the same non-determinism boundary the
`FootballBets` example uses — so the leader and every validator each independently
re-run the live check as part of reaching consensus, rather than trusting one
node's fetch.

The result — `verified reachable (HTTP <code>): <url>`, `verification failed (...)`,
or `not checked (no http/https file reference present)` — is folded into the case
JSON as `delivery_url_reachability_check`, and `JUDGMENT_TASK` instructs the model to
treat an explicit failure as material evidence but treat "not checked" as neutral.
The demo data uses `ipfs://` references (not resolvable via plain HTTP HEAD), so it
always reports "not checked" in the current demo runs — that's intentional: a
non-http scheme is genuinely unverifiable this way, and the check is designed to
never manufacture a false negative out of that. Any agreement that delivers a real
`http(s)://` reference exercises the live check end-to-end; see
`tests/direct/test_judgment.py` for coverage of both the success and failure paths
via `direct_vm.mock_web()`.

## Judgment questions

1. Was the agreement fulfilled overall?
2. Was the originality requirement satisfied (no copyrighted material)?
3. Is there sufficient evidence supporting the buyer's copyright claim?
4. Were the required file formats (PNG/SVG/source) delivered?
5. Was the deadline satisfied?
6. What settlement outcome follows?

## Pipeline

**Correction from an earlier draft of this doc:** it originally assumed the contract
calls `gl.nondet.exec_prompt` itself and then wraps that result in
`gl.eq_principle.prompt_non_comparative`. Reading the real SDK source
(`genlayer/eq_principle/__init__.py`, v0.3.0-rc7) shows that's backwards —
`prompt_non_comparative(fn, task, criteria)` expects `fn` to return the raw **input
string**; the LLM call itself is performed internally by the framework (via its
`ExecPromptTemplate` with the `EqNonComparativeLeader`/`EqNonComparativeValidator`
templates), using the `task`/`criteria` you supply. The actual, verified pipeline:

```
leader_input() -> str                 # closure; no LLM call in our code
   → _verify_delivery_reachability()  # live gl.nondet.web.head() check (non-deterministic,
                                       #   must run inside this closure, not before it)
   → _build_case_text(..., reachability) -> case_text (JSON, sort_keys=True)
   → gl.eq_principle.prompt_non_comparative(leader_input, task=JUDGMENT_TASK, criteria=JUDGMENT_CRITERIA)
        [leader]    framework runs ExecPromptTemplate/EqNonComparativeLeader(task, input=case_text) -> str
        [validator] framework runs ExecPromptTemplate/EqNonComparativeValidator(task, output=leader's str,
                     input=validator's own case_text, criteria) -> bool agreement
   → consensus on whether validators accept the leader's output under `criteria`
   → .get() returns the leader's raw string to our contract code
   → _parse_and_validate_judgment(raw): strict JSON schema validation (see below)
   → finalized Judgment struct written to storage
   → _settle_from_judgment(): deterministic bps mapping, single payout helper
```

`JUDGMENT_TASK` is the instruction that tells the leader what to produce from
`case_text` (respond with only the judgment JSON, following the schema). `JUDGMENT_CRITERIA`
is what validators check the leader's JSON against (schema-valid, bps consistent with
decision, reason codes grounded in the case, summary accurate) — see
`contracts/courtflow.py` for the exact prompt text.

## Why `prompt_non_comparative`, not `strict_eq` or `prompt_comparative`

- `gl.eq_principle.strict_eq` requires byte-identical leader/validator output. LLM text
  is not reproducible across nodes — using it here would make consensus fail almost
  every round. Reserved for genuinely deterministic sub-checks only (e.g. exact string
  match of a fetched webpage field), not for the judgment itself.
- `gl.eq_principle.prompt_comparative` makes every validator re-run the full LLM
  reasoning task and then has an LLM compare leader vs. validator outputs. Workable,
  but ~N× the LLM cost of `prompt_non_comparative` and still exposed to answer drift
  between independent re-generations for a task this open-ended.
- `gl.eq_principle.prompt_non_comparative(fn, task=..., criteria=...)` has only the
  leader run the judgment task once; validators evaluate the leader's structured
  output against explicit `criteria` (schema-valid, decision internally consistent
  with reason_codes, payout_bps in range, summary grounded in the evidence given).
  This matches the spec's requirement exactly: **validators agree on the normalized
  decision, not on identical reasoning prose.**

## Normalized output (the only thing that can reach settlement)

```json
{
  "decision": "FULFILLED | FAILED | PARTIAL | INSUFFICIENT_EVIDENCE",
  "payout_bps": 0,
  "reason_codes": ["ORIGINALITY_VIOLATED", "DEADLINE_MET", "..."],
  "summary": "<= 500 chars"
}
```

## LLM resilience — validation before anything touches storage

`_parse_and_validate_judgment` (contract-side, after `.get()` returns the leader's raw
string) must:
1. Parse the returned string as JSON; guard against non-JSON output.
2. Validate `decision` is one of the four allowed enum values — reject otherwise.
3. Validate `0 <= payout_bps <= 10000` — clamp is not acceptable, reject and retry/error.
4. Validate `decision` and `payout_bps` are mutually consistent (`FULFILLED`→10000,
   `FAILED`/`INSUFFICIENT_EVIDENCE`→0, `PARTIAL`→ strictly between 0 and 10000) —
   the contract enforces this mapping itself rather than trusting the LLM's bps for
   the non-PARTIAL cases, so a malformed bps on a FULFILLED/FAILED decision can never
   misroute funds.
5. Cap `summary` length; drop unrecognized fields rather than erroring on them.
6. Any failure here raises `gl.vm.UserError` with a deterministic error classification
   (`EXPECTED` for a caller-triggerable input issue, `LLM_ERROR` for schema violations,
   `TRANSIENT`/`EXTERNAL` for `NondetException` from the web/LLM backend) — it must
   never fall through to `_send_gen`.

## Judgment → settlement mapping (deterministic, contract-owned)

| decision | provider bps | buyer bps |
|---|---|---|
| FULFILLED | 10000 | 0 |
| FAILED | 0 | 10000 |
| PARTIAL | `judgment.payout_bps` | `10000 - judgment.payout_bps` |
| INSUFFICIENT_EVIDENCE | 10000 | 0 |

`INSUFFICIENT_EVIDENCE` pays the provider in full, same as `FULFILLED`: the burden of
proof is on the buyer's disputing claim, and delivery already happened (escrow was
funded, provider submitted a deliverable) — an unproven claim does not undo that by
default. This must be stated explicitly here because it is the one place a naive
reading of "insufficient evidence" could be misimplemented as a refund.

The LLM never calls `_send_gen`. It produces a `Judgment` struct; a separate,
non-nondet contract method reads that struct and performs the split via the single
payout helper described in `docs/contract-spec.md`.

## Failure handling summary

| Failure | Classification | Contract behavior |
|---|---|---|
| Web/LLM backend error (`NondetException`) | TRANSIENT/EXTERNAL | `UserError`, judgment not written, dispute stays `UNDER_REVIEW`, retriable |
| Malformed JSON / missing fields | LLM_ERROR | `UserError`, no state change |
| `decision` not in enum | LLM_ERROR | `UserError`, no state change |
| `payout_bps` out of range | LLM_ERROR | `UserError`, no state change |
| Caller not buyer/provider | EXPECTED | `UserError`, no state change |
| Judgment already exists for this dispute | EXPECTED | `UserError` (prevents re-judging / double settlement) |
