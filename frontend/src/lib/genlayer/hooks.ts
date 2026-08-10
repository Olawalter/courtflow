"use client";

import { useCallback, useEffect, useState } from "react";
import { readClient } from "./readClient";
import { COURTFLOW_ADDRESS, readCourtFlow, toCalldataAddress } from "./contract";
import type { Agreement, Delivery, Dispute, Judgment, Reputation } from "./types";

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface Result<T> extends AsyncState<T> {
  deployed: boolean;
  refetch: () => void;
}

const DEPLOYED = Boolean(COURTFLOW_ADDRESS);

function useCourtFlowRead<T>(
  fn: string,
  args: unknown[] = [],
  deps: unknown[] = [],
  skip = false
): Result<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: DEPLOYED && !skip,
    error: null,
  });
  // Bumped by refetch() -- included in the effect's deps so callers can force
  // a re-read after a write, since nothing else here would otherwise change
  // when only on-chain state (not props) has moved.
  const [nonce, setNonce] = useState(0);
  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!DEPLOYED || skip) return;

    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    readCourtFlow<T>(readClient, fn, args)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled)
          setState({
            data: null,
            loading: false,
            error: err instanceof Error ? err.message : "Failed to read contract",
          });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip, nonce, ...deps]);

  return { ...state, deployed: DEPLOYED, refetch };
}

export function useAgreements() {
  return useCourtFlowRead<Record<string, Agreement>>("get_agreements", []);
}

export function useAgreement(id: string) {
  return useCourtFlowRead<Agreement>("get_agreement", [id], [id]);
}

export function useDispute(id: string) {
  return useCourtFlowRead<Dispute>("get_dispute", [id], [id]);
}

export function useDelivery(agreementId: string, skip = false) {
  // get_delivery reverts until submit_delivery has actually happened; callers
  // pass skip=true while the agreement is still DRAFT/ACTIVE/FUNDED to avoid
  // triggering that (see useJudgment for the same pattern and why).
  return useCourtFlowRead<Delivery>("get_delivery", [agreementId], [agreementId], skip);
}

export function useJudgment(disputeId: string | null) {
  return useCourtFlowRead<Judgment>(
    "get_judgment",
    [disputeId],
    [disputeId],
    disputeId == null
  );
}

export function useReputation(address: string | null) {
  return useCourtFlowRead<Reputation>(
    "get_reputation",
    [address ? toCalldataAddress(address) : null],
    [address],
    address == null
  );
}
