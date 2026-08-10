# CourtFlow — Contract Spec

Target SDK: GenLayer `py-genlayer` stdlib **v0.3.0-rc7** (verified from the real
package extracted by `genvm-lint download`), decorators/storage per
`from genlayer import *`.

## State machine

```
DRAFT → ACTIVE → FUNDED → ACCEPTED → DELIVERED
                                        │
                        ┌───────────────┼────────────────┐
                        ▼                                ▼
                    APPROVED                          DISPUTED
                        │                                 │
                    SETTLED                          UNDER_REVIEW
                                                           │
                                                        JUDGED
                                                           │
                                         ┌─────────────────┼─────────────────┐
                                         ▼                 ▼                 ▼
                                      PASSED            FAILED           PARTIAL
                                         └─────────────────┼─────────────────┘
                                                            ▼
                                                        SETTLED

Also reachable:
  DRAFT/ACTIVE  → CANCELLED  (buyer cancels before provider acceptance → refund)
  FUNDED/ACCEPTED/DELIVERED → TIMED_OUT (counterparty inactive past deadline → recovery)
```

Illegal transitions (e.g. `CANCELLED → DELIVERED`, `SETTLED → *`) must raise
`gl.vm.UserError` and leave state untouched.

## Storage model

```python
@allow_storage
@dataclass
class Agreement:
    agreement_id: str
    buyer: Address
    provider: Address
    terms: str
    agreed_amount: u256       # what was agreed — NEVER used for payout math
    escrow_deposited: u256    # actual custody — the ONLY source for payout math
    deadline: u256            # unix timestamp
    dispute_window: u256      # seconds, from delivery
    created_at: u256
    delivered_at: u256
    status: str                # DRAFT/ACTIVE/FUNDED/.../SETTLED/CANCELLED/TIMED_OUT

@allow_storage
@dataclass
class Delivery:
    delivery_id: str
    agreement_id: str
    submitted_at: u256
    file_refs: DynArray[str]   # hashes/URIs, never raw file bytes
    metadata: str
    status: str

@allow_storage
@dataclass
class Dispute:
    dispute_id: str
    agreement_id: str
    claim: str
    provider_response: str
    created_at: u256
    status: str                 # OPEN/UNDER_REVIEW/JUDGED

@allow_storage
@dataclass
class Judgment:
    decision: str                # FULFILLED/FAILED/PARTIAL/INSUFFICIENT_EVIDENCE
    payout_bps: u256             # 0..10000, provider's share
    reason_codes: DynArray[str]
    summary: str

@allow_storage
@dataclass
class Reputation:
    completed: u256
    disputes_opened: u256
    disputes_won: u256
    disputes_lost: u256
    partials: u256
    late_deliveries: u256
    revision_requests: u256

class CourtFlow(gl.Contract):
    agreements: TreeMap[str, Agreement]
    deliveries: TreeMap[str, Delivery]
    disputes: TreeMap[str, Dispute]
    judgments: TreeMap[str, Judgment]
    reputation: TreeMap[Address, Reputation]
```

## Access control

- `create_agreement`: caller becomes `buyer`.
- `accept_agreement`: only `provider`.
- `fund_agreement` (`@gl.public.write.payable`): only `buyer`, only in `ACTIVE`.
- `submit_delivery`: only `provider`, only in `FUNDED`/`ACCEPTED`.
- `approve_delivery`: only `buyer`.
- `open_dispute`: only `buyer`, only within `dispute_window` after `delivered_at`.
- `respond_to_dispute`: only `provider`.
- `run_judgment`: either party may trigger once evidence is assembled; only in `UNDER_REVIEW`.
- `claim_timeout`: only the eligible counterparty, only after `deadline`/`dispute_window` elapsed with no action.
- `cancel_agreement`: only `buyer`, only before `provider` accepts.

Every write validates `gl.message.sender_address` against the stored `buyer`/`provider`
before mutating state.

## Escrow custody

- Only `fund_agreement` is `@gl.public.write.payable`.
- Authoritative amount is `gl.message.value`, never a caller-supplied parameter.
- Reject `gl.message.value == 0` and `gl.message.value != agreement.agreed_amount`
  (exact equality required — no "at least X").
- `escrow_deposited = gl.message.value` is set once; `agreed_amount` is never touched
  again after creation.

## Single payout choke point

```python
def _send_gen(self, recipient: Address, amount: u256) -> None:
    if amount == 0:
        return
    gl.Account(recipient).emit_transfer(amount, on='finalized')
```

Every payout path (`approve_delivery` success, judgment settlement, cancellation
refund, timeout recovery) calls only `_send_gen`. No other code path calls
`emit_transfer`.

## Settlement ordering (mandatory, every path)

```
1. Read agreement.escrow_deposited
2. Require > 0 (else UserError — already settled / nothing to pay)
3. Compute payout split(s) from escrow_deposited
4. Set agreement.escrow_deposited = 0
5. Set agreement.status = SETTLED (persist)
6. _send_gen(...) for each recipient
```
Zero-then-transfer, never transfer-then-zero. A second call to any settlement path
must fail at step 2 (`escrow_deposited == 0`), proving double-spend is impossible.

## Payout paths (exhaustive — no other path exists)

| Path | Trigger | Payout |
|---|---|---|
| Success | buyer `approve_delivery` | 100% → provider |
| Judgment FULFILLED | judgment finalized | 100% → provider |
| Judgment FAILED | judgment finalized | 100% → buyer (refund) |
| Judgment PARTIAL | judgment finalized | `payout_bps` → provider, remainder → buyer |
| Judgment INSUFFICIENT_EVIDENCE | judgment finalized | 100% → provider (burden of proof was on the buyer's disputing claim; unproven claim does not undo an already-made delivery) |
| Cancellation | buyer, pre-acceptance | 100% → buyer (refund) |
| Delivery timeout | `claim_timeout`: provider never delivered before `deadline` | 100% → buyer (refund) |
| Post-delivery timeout | `claim_delivery_timeout`: buyer never approved or disputed before `dispute_window` closed | 100% → provider |

Both timeout paths exist for the same reason: without `claim_delivery_timeout`, an
unresponsive buyer post-delivery would leave escrow stuck forever (`DELIVERED` has
no other exit once the dispute window lapses) — this gap was caught in the security
review pass (see `git log`/session notes) and closed by adding the symmetric
provider-side recovery path.

## Reputation

Updated exactly once, only from `_settle` (the single internal function all payout
paths funnel through after step 5), keyed off the finalized `Judgment`/outcome — never
from `open_dispute` alone (opening a dispute must not itself penalize anyone).
