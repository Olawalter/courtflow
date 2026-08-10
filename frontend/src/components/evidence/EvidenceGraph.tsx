"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Agreement, Delivery, Dispute } from "@/lib/genlayer/types";

interface EvidenceNode {
  id: string;
  label: string;
  preview: string;
  detail: string;
}

function buildNodes(agreement: Agreement, delivery: Delivery | null, dispute: Dispute): EvidenceNode[] {
  const nodes: EvidenceNode[] = [
    {
      id: "clause",
      label: "Agreement Clause",
      preview: agreement.terms.split("\n")[0],
      detail: agreement.terms,
    },
  ];

  if (delivery) {
    nodes.push({
      id: "deliverable",
      label: "Deliverable",
      preview: `${delivery.file_refs.length} file${delivery.file_refs.length === 1 ? "" : "s"}`,
      detail: delivery.file_refs.join("\n") || "(no file references)",
    });
    nodes.push({
      id: "timestamp",
      label: "Delivery Timestamp",
      preview: new Date(delivery.submitted_at).toLocaleString(),
      detail: `Submitted ${new Date(delivery.submitted_at).toLocaleString()}\nDeadline was ${new Date(
        agreement.deadline
      ).toLocaleString()}\n${
        new Date(delivery.submitted_at) > new Date(agreement.deadline) ? "Delivered LATE" : "Delivered on time"
      }`,
    });
  }

  nodes.push({
    id: "response",
    label: "Provider Response",
    preview: dispute.provider_response ? dispute.provider_response.split("\n")[0] : "(no response yet)",
    detail: dispute.provider_response || "The provider has not responded to this dispute yet.",
  });

  nodes.push({
    id: "escrow",
    label: "Escrow State",
    preview: `${agreement.escrow_deposited} held`,
    detail: `agreed_amount and escrow_deposited are tracked as separate fields on-chain -- this shows the actual custodied amount, not just what was agreed.\n\nescrow_deposited: ${agreement.escrow_deposited}\nagreed_amount: ${agreement.agreed_amount}`,
  });

  return nodes;
}

export function EvidenceGraph({
  agreement,
  delivery,
  dispute,
}: {
  agreement: Agreement;
  delivery: Delivery | null;
  dispute: Dispute;
}) {
  const nodes = buildNodes(agreement, delivery, dispute);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-center gap-0">
      <EvidenceCard
        label="Buyer Claim"
        preview={`"${dispute.claim}"`}
        expanded={expanded === "claim"}
        onToggle={() => setExpanded(expanded === "claim" ? null : "claim")}
        tone="dispute"
      />

      <svg width="2" height="28" className="text-border" aria-hidden>
        <line x1="1" y1="0" x2="1" y2="28" stroke="currentColor" strokeWidth="2" />
      </svg>

      <div className="relative w-full">
        <div
          className="absolute left-1/2 -translate-x-1/2 -top-0 h-px bg-border"
          style={{ width: `calc(100% - ${100 / nodes.length}%)` }}
          aria-hidden
        />
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-4 pt-0">
          {nodes.map((node) => (
            <div key={node.id} className="flex flex-col items-center">
              <svg width="2" height="16" className="text-border" aria-hidden>
                <line x1="1" y1="0" x2="1" y2="16" stroke="currentColor" strokeWidth="2" />
              </svg>
              <EvidenceCard
                label={node.label}
                preview={node.preview}
                detail={node.detail}
                expanded={expanded === node.id}
                onToggle={() => setExpanded(expanded === node.id ? null : node.id)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EvidenceCard({
  label,
  preview,
  detail,
  expanded,
  onToggle,
  tone = "default",
}: {
  label: string;
  preview: string;
  detail?: string;
  expanded: boolean;
  onToggle: () => void;
  tone?: "default" | "dispute";
}) {
  return (
    <button
      onClick={detail ? onToggle : undefined}
      className={cn(
        "flex flex-col gap-1 rounded-lg border px-4 py-3 text-left transition-colors w-56",
        tone === "dispute"
          ? "border-dispute/40 bg-dispute/5 hover:border-dispute/60"
          : "border-border bg-surface hover:border-primary/50",
        !detail && "cursor-default"
      )}
    >
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground line-clamp-2">{preview}</span>
      {detail && expanded && (
        <pre className="mt-2 whitespace-pre-wrap border-t border-border pt-2 text-xs text-muted-foreground font-sans">
          {detail}
        </pre>
      )}
      {detail && (
        <span className="text-[10px] text-muted-foreground">{expanded ? "click to collapse" : "click to inspect"}</span>
      )}
    </button>
  );
}
