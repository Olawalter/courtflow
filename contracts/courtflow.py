# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import datetime
import json
from dataclasses import dataclass
from genlayer import *

# Per the official docs (developers/intelligent-contracts/features/value-transfers):
# sending GEN to an EOA is an *external message* through an EVM contract
# interface proxy -- gl.chain.Account/gl.get_contract_at are for IC-to-IC
# transfers and do not work for plain addresses (verified: both raised
# AttributeError on live StudioNet).
@gl.evm.contract_interface
class _Recipient:
    class View:
        pass

    class Write:
        pass


STATUS_DRAFT = "DRAFT"
STATUS_ACTIVE = "ACTIVE"
STATUS_FUNDED = "FUNDED"
STATUS_ACCEPTED = "ACCEPTED"
STATUS_DELIVERED = "DELIVERED"
STATUS_APPROVED = "APPROVED"
STATUS_DISPUTED = "DISPUTED"
STATUS_UNDER_REVIEW = "UNDER_REVIEW"
STATUS_JUDGED = "JUDGED"
STATUS_SETTLED = "SETTLED"
STATUS_CANCELLED = "CANCELLED"
STATUS_TIMED_OUT = "TIMED_OUT"

DISPUTE_OPEN = "OPEN"
DISPUTE_UNDER_REVIEW = "UNDER_REVIEW"
DISPUTE_JUDGED = "JUDGED"

DECISION_FULFILLED = "FULFILLED"
DECISION_FAILED = "FAILED"
DECISION_PARTIAL = "PARTIAL"
DECISION_INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
DECISIONS = (
    DECISION_FULFILLED,
    DECISION_FAILED,
    DECISION_PARTIAL,
    DECISION_INSUFFICIENT_EVIDENCE,
)

# The leader produces this JSON from the case text; validators check it against
# JUDGMENT_CRITERIA without re-running the LLM themselves
# (see docs/adjudication-model.md for why prompt_non_comparative was chosen).
JUDGMENT_TASK = (
    "You are adjudicating a commerce dispute between a buyer and an AI logo-design "
    "provider on CourtFlow. Given the CASE JSON in the input, decide the outcome. "
    "Respond with ONLY a JSON object with exactly these fields: "
    '{"decision": "FULFILLED"|"FAILED"|"PARTIAL"|"INSUFFICIENT_EVIDENCE", '
    '"payout_bps": <integer 0-10000, provider share>, '
    '"reason_codes": [<short UPPER_SNAKE_CASE codes>], '
    '"summary": <string, at most 400 characters>}. '
    "FULFILLED: the provider fully met the agreement and the buyer's claim is unfounded. "
    "FAILED: the buyer's claim is substantiated and the agreement was not fulfilled. "
    "PARTIAL: the deliverable partially met the requirements; payout_bps must be "
    "strictly between 0 and 10000, reflecting the provider's share. "
    "INSUFFICIENT_EVIDENCE: there is not enough evidence to substantiate the buyer's "
    "claim. The burden of proof is on the claim, so treat this the same as FULFILLED "
    "for payout purposes. The CASE JSON includes a "
    "delivery_url_reachability_check field: a live check of whether a delivered "
    "file reference actually resolves over HTTP(S), performed independently of the "
    "provider's own claims. Treat an explicit 'verification failed' result as "
    "material evidence the deliverable may not be genuine or accessible as claimed. "
    "'not checked' means no http/https reference was present to verify and carries "
    "no weight either way. Do not include any prose outside the JSON object."
)

JUDGMENT_CRITERIA = (
    "The output must be a single valid JSON object with exactly the fields decision, "
    "payout_bps, reason_codes, summary. decision must be one of FULFILLED, FAILED, "
    "PARTIAL, INSUFFICIENT_EVIDENCE. payout_bps must be an integer between 0 and 10000 "
    "inclusive and internally consistent with decision (10000 for FULFILLED and "
    "INSUFFICIENT_EVIDENCE, 0 for FAILED, strictly between 0 and 10000 for PARTIAL). "
    "reason_codes must be grounded in the CASE JSON's agreement terms, buyer claim, "
    "provider response, and delivery_url_reachability_check, not invented. summary "
    "must accurately and concisely reflect the decision and the evidence it is based on."
)


@allow_storage
@dataclass
class Agreement:
    agreement_id: str
    buyer: Address
    provider: Address
    terms: str
    agreed_amount: u256
    escrow_deposited: u256
    deadline: datetime.datetime
    dispute_window_seconds: u256
    created_at: datetime.datetime
    delivered_at: datetime.datetime  # sentinel: equals created_at until delivery happens
    was_late: bool
    status: str


@allow_storage
@dataclass
class Delivery:
    delivery_id: str
    agreement_id: str
    submitted_at: datetime.datetime
    file_refs: DynArray[str]
    metadata: str
    status: str


@allow_storage
@dataclass
class Dispute:
    dispute_id: str
    agreement_id: str
    claim: str
    provider_response: str
    created_at: datetime.datetime
    status: str


@allow_storage
@dataclass
class Judgment:
    decision: str
    payout_bps: u256
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
    deliveries: TreeMap[str, Delivery]  # keyed by agreement_id (one active delivery per agreement in MVP)
    disputes: TreeMap[str, Dispute]  # keyed by dispute_id
    judgments: TreeMap[str, Judgment]  # keyed by dispute_id
    reputation: TreeMap[Address, Reputation]

    def __init__(self):
        pass

    def _require_agreement(self, agreement_id: str) -> Agreement:
        if agreement_id not in self.agreements:
            raise gl.vm.UserError("agreement not found")
        return self.agreements[agreement_id]

    def _require_status(self, agreement: Agreement, *allowed: str) -> None:
        if agreement.status not in allowed:
            raise gl.vm.UserError(
                f"illegal transition: agreement is {agreement.status}, expected one of {allowed}"
            )

    def _now(self) -> datetime.datetime:
        # Verified on live StudioNet: gl.message is a restricted MessageType
        # instance with neither .raw nor .datetime (confirmed via on-chain
        # AttributeError). GenVM instead provides deterministic, validator-
        # agreed time transparently through the standard library: the direct
        # test runner (gltest) patches datetime.datetime.now() for exactly
        # this reason, and the same pattern holds on the real runner.
        now = datetime.datetime.now()
        if now.tzinfo is None:
            now = now.replace(tzinfo=datetime.timezone.utc)
        return now

    @gl.public.write
    def create_agreement(
        self,
        agreement_id: str,
        provider: Address,
        terms: str,
        agreed_amount: u256,
        deadline: str,  # ISO 8601 datetime string
        dispute_window_seconds: u256,
    ) -> None:
        if agreement_id in self.agreements:
            raise gl.vm.UserError("agreement_id already exists")
        if agreed_amount == 0:
            raise gl.vm.UserError("agreed_amount must be > 0")

        buyer = gl.message.sender_address
        if provider == buyer:
            raise gl.vm.UserError("buyer and provider must differ")

        deadline_dt = datetime.datetime.fromisoformat(deadline)
        now = self._now()
        if deadline_dt <= now:
            raise gl.vm.UserError("deadline must be in the future")

        self.agreements[agreement_id] = Agreement(
            agreement_id=agreement_id,
            buyer=buyer,
            provider=provider,
            terms=terms,
            agreed_amount=agreed_amount,
            escrow_deposited=u256(0),
            deadline=deadline_dt,
            dispute_window_seconds=dispute_window_seconds,
            created_at=now,
            delivered_at=now,
            was_late=False,
            status=STATUS_DRAFT,
        )

    @gl.public.write
    def accept_agreement(self, agreement_id: str) -> None:
        agreement = self._require_agreement(agreement_id)
        self._require_status(agreement, STATUS_DRAFT)

        if gl.message.sender_address != agreement.provider:
            raise gl.vm.UserError("only the provider may accept")

        agreement.status = STATUS_ACTIVE

    @gl.public.write
    def cancel_agreement(self, agreement_id: str) -> None:
        agreement = self._require_agreement(agreement_id)
        self._require_status(agreement, STATUS_DRAFT)

        if gl.message.sender_address != agreement.buyer:
            raise gl.vm.UserError("only the buyer may cancel")

        agreement.status = STATUS_CANCELLED

    @gl.public.write.payable
    def fund_agreement(self, agreement_id: str) -> None:
        agreement = self._require_agreement(agreement_id)
        self._require_status(agreement, STATUS_ACTIVE)

        if gl.message.sender_address != agreement.buyer:
            raise gl.vm.UserError("only the buyer may fund")

        deposited = gl.message.value
        if deposited == 0:
            raise gl.vm.UserError("deposit must be > 0")
        if deposited != agreement.agreed_amount:
            raise gl.vm.UserError(
                f"deposit must equal agreed_amount exactly: expected {agreement.agreed_amount}, got {deposited}"
            )

        agreement.escrow_deposited = deposited
        agreement.status = STATUS_FUNDED

    def _require_delivery(self, agreement_id: str) -> Delivery:
        if agreement_id not in self.deliveries:
            raise gl.vm.UserError("delivery not found")
        return self.deliveries[agreement_id]

    def _require_dispute(self, dispute_id: str) -> Dispute:
        if dispute_id not in self.disputes:
            raise gl.vm.UserError("dispute not found")
        return self.disputes[dispute_id]

    @gl.public.write
    def submit_delivery(
        self,
        agreement_id: str,
        delivery_id: str,
        file_refs: list[str],
        metadata: str,
    ) -> None:
        agreement = self._require_agreement(agreement_id)
        self._require_status(agreement, STATUS_FUNDED)

        if gl.message.sender_address != agreement.provider:
            raise gl.vm.UserError("only the provider may submit delivery")
        if agreement_id in self.deliveries:
            raise gl.vm.UserError("delivery already submitted for this agreement")
        if len(file_refs) == 0:
            raise gl.vm.UserError("at least one file reference is required")

        now = self._now()
        # DynArray can't be instantiated by user code (TypeError, verified on
        # live GenVM) -- the storage layer accepts a plain list/Sequence
        # directly when assigning a DynArray-typed field, so pass one.
        self.deliveries[agreement_id] = Delivery(
            delivery_id=delivery_id,
            agreement_id=agreement_id,
            submitted_at=now,
            file_refs=list(file_refs[:20]),
            metadata=metadata,
            status="SUBMITTED",
        )
        agreement.delivered_at = now
        agreement.was_late = now > agreement.deadline
        agreement.status = STATUS_DELIVERED

    def _send_gen(self, recipient: Address, amount: u256) -> None:
        if amount == 0:
            return
        _Recipient(recipient).emit_transfer(value=amount)

    def _settle(self, agreement: Agreement, provider_amount: u256, buyer_amount: u256) -> None:
        deposited = agreement.escrow_deposited
        if deposited == 0:
            raise gl.vm.UserError("escrow already settled")
        if provider_amount + buyer_amount != deposited:
            raise gl.vm.UserError("payout split does not match escrow_deposited")

        # zero + persist state BEFORE any transfer, per settlement ordering rule
        agreement.escrow_deposited = u256(0)
        agreement.status = STATUS_SETTLED

        self._send_gen(agreement.provider, provider_amount)
        self._send_gen(agreement.buyer, buyer_amount)

    def _get_or_create_reputation(self, addr: Address) -> Reputation:
        if addr not in self.reputation:
            self.reputation[addr] = Reputation(
                completed=u256(0),
                disputes_opened=u256(0),
                disputes_won=u256(0),
                disputes_lost=u256(0),
                partials=u256(0),
                late_deliveries=u256(0),
                revision_requests=u256(0),
            )
        return self.reputation[addr]

    @gl.public.write
    def approve_delivery(self, agreement_id: str) -> None:
        agreement = self._require_agreement(agreement_id)
        self._require_status(agreement, STATUS_DELIVERED)

        if gl.message.sender_address != agreement.buyer:
            raise gl.vm.UserError("only the buyer may approve delivery")

        deposited = agreement.escrow_deposited
        self._settle(agreement, deposited, u256(0))

        provider_rep = self._get_or_create_reputation(agreement.provider)
        provider_rep.completed += u256(1)
        if agreement.was_late:
            provider_rep.late_deliveries += u256(1)

    @gl.public.write
    def open_dispute(self, agreement_id: str, dispute_id: str, claim: str) -> None:
        agreement = self._require_agreement(agreement_id)
        self._require_status(agreement, STATUS_DELIVERED)

        if gl.message.sender_address != agreement.buyer:
            raise gl.vm.UserError("only the buyer may open a dispute")
        if dispute_id in self.disputes:
            raise gl.vm.UserError("dispute_id already exists")
        if len(claim.strip()) == 0:
            raise gl.vm.UserError("claim must not be empty")

        window_end = agreement.delivered_at + datetime.timedelta(
            seconds=int(agreement.dispute_window_seconds)
        )
        if self._now() > window_end:
            raise gl.vm.UserError("dispute window has closed")

        self.disputes[dispute_id] = Dispute(
            dispute_id=dispute_id,
            agreement_id=agreement_id,
            claim=claim,
            provider_response="",
            created_at=self._now(),
            status=DISPUTE_OPEN,
        )
        agreement.status = STATUS_DISPUTED

    @gl.public.write
    def respond_to_dispute(self, dispute_id: str, response: str) -> None:
        dispute = self._require_dispute(dispute_id)
        agreement = self._require_agreement(dispute.agreement_id)
        self._require_status(agreement, STATUS_DISPUTED)

        if dispute.status != DISPUTE_OPEN:
            raise gl.vm.UserError("dispute is not open for a response")
        if gl.message.sender_address != agreement.provider:
            raise gl.vm.UserError("only the provider may respond to a dispute")

        dispute.provider_response = response
        dispute.status = DISPUTE_UNDER_REVIEW
        agreement.status = STATUS_UNDER_REVIEW

    def _verify_delivery_reachability(self, delivery: Delivery) -> str:
        # Live, independent check that a delivered file reference actually
        # resolves -- not just trusting the provider's claim. Only meaningful
        # for http(s) URLs; other schemes (ipfs://, etc.) can't be HEAD-ed, so
        # they're reported as "not checked" rather than "failed" -- absence of
        # a check must never read as negative evidence. Runs inside the
        # eq_principle leader_input closure (see run_judgment) since
        # gl.nondet.web is a non-deterministic call.
        for ref in delivery.file_refs:
            if not (ref.startswith("http://") or ref.startswith("https://")):
                continue
            try:
                response = gl.nondet.web.head(ref)
                if 200 <= response.status < 400:
                    return f"verified reachable (HTTP {response.status}): {ref}"
                return f"verification failed (HTTP {response.status}): {ref}"
            except Exception:
                return f"verification failed (request error): {ref}"
        return "not checked (no http/https file reference present)"

    def _build_case_text(
        self,
        agreement: Agreement,
        delivery: Delivery,
        dispute: Dispute,
        delivery_url_reachability_check: str,
    ) -> str:
        case = {
            "agreement": {
                "terms": agreement.terms,
                "agreed_amount": agreement.agreed_amount,
                "deadline": agreement.deadline.isoformat(),
                "escrow_deposited": agreement.escrow_deposited,
            },
            "buyer_claim": dispute.claim,
            "provider_response": dispute.provider_response,
            "deliverable": {
                "file_refs": [ref for ref in delivery.file_refs],
                "metadata": delivery.metadata,
                "submitted_at": delivery.submitted_at.isoformat(),
            },
            "delivery_deadline_met": not agreement.was_late,
            "dispute_window_expiry": (
                agreement.delivered_at
                + datetime.timedelta(seconds=int(agreement.dispute_window_seconds))
            ).isoformat(),
            "delivery_url_reachability_check": delivery_url_reachability_check,
        }
        return json.dumps(case, sort_keys=True)

    def _parse_and_validate_judgment(self, raw: str) -> Judgment:
        # LLMs routinely wrap JSON in markdown code fences despite explicit
        # instructions not to (verified live: this happened on a real
        # StudioNet run). Strip that formatting before parsing, same as the
        # official GenLayer example contracts do for the same reason.
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.lstrip("`")
            if cleaned.lower().startswith("json"):
                cleaned = cleaned[4:]
            cleaned = cleaned.strip().rstrip("`").strip()

        try:
            data = json.loads(cleaned)
        except (ValueError, TypeError):
            raise gl.vm.UserError("LLM_ERROR: judgment output was not valid JSON")

        if not isinstance(data, dict):
            raise gl.vm.UserError("LLM_ERROR: judgment output was not a JSON object")

        decision = data.get("decision")
        if decision not in DECISIONS:
            raise gl.vm.UserError(f"LLM_ERROR: invalid decision {decision!r}")

        raw_bps = data.get("payout_bps")
        if not isinstance(raw_bps, int) or isinstance(raw_bps, bool):
            raise gl.vm.UserError("LLM_ERROR: payout_bps missing or not an integer")
        if raw_bps < 0 or raw_bps > 10000:
            raise gl.vm.UserError("LLM_ERROR: payout_bps out of range")

        # The contract, not the LLM, is authoritative for the bps of non-PARTIAL
        # decisions -- a malformed bps can never misroute funds for those cases.
        if decision in (DECISION_FULFILLED, DECISION_INSUFFICIENT_EVIDENCE):
            payout_bps = 10000
        elif decision == DECISION_FAILED:
            payout_bps = 0
        else:
            if raw_bps <= 0 or raw_bps >= 10000:
                raise gl.vm.UserError(
                    "LLM_ERROR: PARTIAL decision requires payout_bps strictly between 0 and 10000"
                )
            payout_bps = raw_bps

        reason_codes_raw = data.get("reason_codes")
        if not isinstance(reason_codes_raw, list):
            raise gl.vm.UserError("LLM_ERROR: reason_codes must be a list")
        reason_codes = [code[:64] for code in reason_codes_raw[:10] if isinstance(code, str)]

        summary = data.get("summary")
        if not isinstance(summary, str):
            raise gl.vm.UserError("LLM_ERROR: summary missing or not a string")

        return Judgment(
            decision=decision,
            payout_bps=u256(payout_bps),
            reason_codes=reason_codes,
            summary=summary[:500],
        )

    def _settle_from_judgment(self, agreement: Agreement, judgment: Judgment) -> None:
        deposited = agreement.escrow_deposited
        provider_amount = (deposited * judgment.payout_bps) // u256(10000)
        buyer_amount = deposited - provider_amount
        self._settle(agreement, provider_amount, buyer_amount)

        provider_rep = self._get_or_create_reputation(agreement.provider)
        provider_rep.disputes_opened += u256(1)
        if judgment.decision == DECISION_FAILED:
            provider_rep.disputes_lost += u256(1)
        elif judgment.decision == DECISION_PARTIAL:
            provider_rep.partials += u256(1)
        else:
            provider_rep.disputes_won += u256(1)
            provider_rep.completed += u256(1)
        if agreement.was_late:
            provider_rep.late_deliveries += u256(1)

    @gl.public.write
    def run_judgment(self, dispute_id: str) -> None:
        dispute = self._require_dispute(dispute_id)
        agreement = self._require_agreement(dispute.agreement_id)
        self._require_status(agreement, STATUS_UNDER_REVIEW)

        if dispute.status != DISPUTE_UNDER_REVIEW:
            raise gl.vm.UserError("dispute is not ready for judgment")
        if dispute_id in self.judgments:
            raise gl.vm.UserError("dispute has already been judged")

        sender = gl.message.sender_address
        if sender != agreement.buyer and sender != agreement.provider:
            raise gl.vm.UserError("only a party to the agreement may trigger judgment")

        delivery = self._require_delivery(agreement.agreement_id)

        def leader_input() -> str:
            # gl.nondet.web is non-deterministic, so the reachability check
            # (and the case text that embeds its result) must be built inside
            # this closure -- it's re-run independently by the leader and by
            # each validator as part of prompt_non_comparative's equivalence
            # check, rather than executed once outside it.
            reachability = self._verify_delivery_reachability(delivery)
            return self._build_case_text(agreement, delivery, dispute, reachability)

        # Verified on live StudioNet: prompt_non_comparative returns a plain
        # str here, not a Lazy[str] (AttributeError: 'str' object has no
        # attribute 'get'), despite the py-lib-genlayer-std source signature.
        # Support both shapes defensively rather than hard-coding either.
        judgment_result = gl.eq_principle.prompt_non_comparative(
            leader_input, task=JUDGMENT_TASK, criteria=JUDGMENT_CRITERIA
        )
        raw = judgment_result.get() if hasattr(judgment_result, "get") else judgment_result

        judgment = self._parse_and_validate_judgment(raw)

        # Settle BEFORE recording the judgment/dispute status: if settlement
        # were ever to raise (e.g. an internal invariant violation), leaving
        # dispute.status at UNDER_REVIEW and judgments[dispute_id] unset means
        # this stays retryable instead of getting stuck in an unrecoverable
        # "judged but never settled" state (agreement.status ends up SETTLED
        # via _settle itself, so it doesn't need to be set here separately).
        self._settle_from_judgment(agreement, judgment)

        self.judgments[dispute_id] = judgment
        dispute.status = DISPUTE_JUDGED

    @gl.public.write
    def claim_timeout(self, agreement_id: str) -> None:
        """Buyer recovery: provider never delivered before the agreement deadline."""
        agreement = self._require_agreement(agreement_id)
        self._require_status(agreement, STATUS_FUNDED)

        if gl.message.sender_address != agreement.buyer:
            raise gl.vm.UserError("only the buyer may claim a delivery timeout")
        if self._now() < agreement.deadline:
            raise gl.vm.UserError("deadline has not passed yet")

        deposited = agreement.escrow_deposited
        self._settle(agreement, u256(0), deposited)
        agreement.status = STATUS_TIMED_OUT

    @gl.public.write
    def claim_delivery_timeout(self, agreement_id: str) -> None:
        """Provider recovery: buyer went silent after delivery -- neither approved nor
        disputed before the dispute window closed. Without this, escrow would be
        stuck forever with no legal exit path once DELIVERED (a real gap: the
        contract had a timeout recovery path for an unresponsive provider but not
        for an unresponsive buyer)."""
        agreement = self._require_agreement(agreement_id)
        self._require_status(agreement, STATUS_DELIVERED)

        if gl.message.sender_address != agreement.provider:
            raise gl.vm.UserError("only the provider may claim a delivery timeout")

        window_end = agreement.delivered_at + datetime.timedelta(
            seconds=int(agreement.dispute_window_seconds)
        )
        if self._now() <= window_end:
            raise gl.vm.UserError("dispute window has not closed yet")

        deposited = agreement.escrow_deposited
        self._settle(agreement, deposited, u256(0))
        agreement.status = STATUS_TIMED_OUT

        provider_rep = self._get_or_create_reputation(agreement.provider)
        provider_rep.completed += u256(1)
        if agreement.was_late:
            provider_rep.late_deliveries += u256(1)

    @gl.public.view
    def get_agreement(self, agreement_id: str) -> dict:
        agreement = self._require_agreement(agreement_id)
        return {
            "agreement_id": agreement.agreement_id,
            "buyer": agreement.buyer.as_hex,
            "provider": agreement.provider.as_hex,
            "terms": agreement.terms,
            "agreed_amount": agreement.agreed_amount,
            "escrow_deposited": agreement.escrow_deposited,
            "deadline": agreement.deadline.isoformat(),
            "dispute_window_seconds": agreement.dispute_window_seconds,
            "delivered_at": agreement.delivered_at.isoformat(),
            "status": agreement.status,
        }

    @gl.public.view
    def get_agreements(self) -> dict:
        return {k: self.get_agreement(k) for k in self.agreements}

    @gl.public.view
    def get_delivery(self, agreement_id: str) -> dict:
        delivery = self._require_delivery(agreement_id)
        return {
            "delivery_id": delivery.delivery_id,
            "agreement_id": delivery.agreement_id,
            "submitted_at": delivery.submitted_at.isoformat(),
            "file_refs": [ref for ref in delivery.file_refs],
            "metadata": delivery.metadata,
            "status": delivery.status,
        }

    @gl.public.view
    def get_dispute(self, dispute_id: str) -> dict:
        dispute = self._require_dispute(dispute_id)
        return {
            "dispute_id": dispute.dispute_id,
            "agreement_id": dispute.agreement_id,
            "claim": dispute.claim,
            "provider_response": dispute.provider_response,
            "created_at": dispute.created_at.isoformat(),
            "status": dispute.status,
        }

    @gl.public.view
    def get_judgment(self, dispute_id: str) -> dict:
        if dispute_id not in self.judgments:
            raise gl.vm.UserError("judgment not found")
        judgment = self.judgments[dispute_id]
        return {
            "decision": judgment.decision,
            "payout_bps": judgment.payout_bps,
            "reason_codes": [code for code in judgment.reason_codes],
            "summary": judgment.summary,
        }

    @gl.public.view
    def get_reputation(self, address: Address) -> dict:
        addr = address
        if addr not in self.reputation:
            return {
                "completed": 0,
                "disputes_opened": 0,
                "disputes_won": 0,
                "disputes_lost": 0,
                "partials": 0,
                "late_deliveries": 0,
                "revision_requests": 0,
            }
        rep = self.reputation[addr]
        return {
            "completed": rep.completed,
            "disputes_opened": rep.disputes_opened,
            "disputes_won": rep.disputes_won,
            "disputes_lost": rep.disputes_lost,
            "partials": rep.partials,
            "late_deliveries": rep.late_deliveries,
            "revision_requests": rep.revision_requests,
        }
