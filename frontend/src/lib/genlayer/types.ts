// Mirrors the dicts returned by contracts/courtflow.py's @gl.public.view methods.
// Keep in sync with docs/contract-spec.md. Re-derive from `genlayer schema` once
// the contract is deployed (build step 17).

export type AgreementStatus =
  | "DRAFT"
  | "ACTIVE"
  | "FUNDED"
  | "DELIVERED"
  | "APPROVED"
  | "DISPUTED"
  | "UNDER_REVIEW"
  | "JUDGED"
  | "SETTLED"
  | "CANCELLED"
  | "TIMED_OUT";

export interface Agreement {
  agreement_id: string;
  buyer: string;
  provider: string;
  terms: string;
  agreed_amount: number;
  escrow_deposited: number;
  deadline: string; // ISO 8601
  dispute_window_seconds: number;
  delivered_at: string; // ISO 8601
  status: AgreementStatus;
}

export interface Delivery {
  delivery_id: string;
  agreement_id: string;
  submitted_at: string;
  file_refs: string[];
  metadata: string;
  status: string;
}

export type DisputeStatus = "OPEN" | "UNDER_REVIEW" | "JUDGED";

export interface Dispute {
  dispute_id: string;
  agreement_id: string;
  claim: string;
  provider_response: string;
  created_at: string;
  status: DisputeStatus;
}

export type JudgmentDecision =
  | "FULFILLED"
  | "FAILED"
  | "PARTIAL"
  | "INSUFFICIENT_EVIDENCE";

export interface Judgment {
  decision: JudgmentDecision;
  payout_bps: number;
  reason_codes: string[];
  summary: string;
}

export interface Reputation {
  completed: number;
  disputes_opened: number;
  disputes_won: number;
  disputes_lost: number;
  partials: number;
  late_deliveries: number;
  revision_requests: number;
}

export function fulfillmentRate(rep: Reputation): number | null {
  if (rep.disputes_opened === 0) return null;
  return Math.round((rep.disputes_won / rep.disputes_opened) * 100);
}
