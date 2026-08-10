"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/StatusBadge";
import type { Judgment } from "@/lib/genlayer/types";

const STAGES = [
  "Analyzing agreement...",
  "Analyzing evidence...",
  "Evaluating claim...",
  "Comparing requirements...",
  "Forming judgment...",
];

const DECISION_LABEL: Record<Judgment["decision"], string> = {
  FULFILLED: "Provider receives escrow",
  FAILED: "Buyer refund",
  PARTIAL: "Split by payout_bps",
  INSUFFICIENT_EVIDENCE: "Provider receives escrow",
};

interface ConsensusAnimationProps {
  /** "running" while a real run_judgment tx is pending, "done" once judgment is on-chain */
  state: "idle" | "running" | "done";
  judgment?: Judgment | null;
  agreedAmount?: number;
}

const NODE_POSITIONS = [
  { x: 50, y: 6 },
  { x: 20, y: 32 },
  { x: 80, y: 32 },
  { x: 12, y: 66 },
  { x: 50, y: 66 },
  { x: 88, y: 66 },
  { x: 50, y: 92 },
];

export function ConsensusAnimation({ state, judgment, agreedAmount }: ConsensusAnimationProps) {
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    if (state !== "running") return;
    let i = -1;
    const id = setInterval(() => {
      i = Math.min(i + 1, STAGES.length - 1);
      setStageIndex(i);
    }, 1400);
    return () => clearInterval(id);
  }, [state]);

  const active = state === "running";

  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <div className="relative mx-auto mb-6 h-56 max-w-xs">
        {NODE_POSITIONS.map((pos, i) => (
          <motion.span
            key={i}
            className={cn(
              "absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full",
              state === "done" ? "bg-consensus" : active ? "bg-consensus/80" : "bg-border"
            )}
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            animate={active ? { scale: [1, 1.4, 1], opacity: [0.6, 1, 0.6] } : { scale: 1 }}
            transition={active ? { duration: 1.2, repeat: Infinity, delay: i * 0.15 } : undefined}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        {state === "idle" && (
          <motion.p
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-center text-sm text-muted-foreground"
          >
            Waiting for judgment to be triggered.
          </motion.p>
        )}

        {active && (
          <motion.p
            key={stageIndex}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="text-center text-sm text-consensus"
          >
            {STAGES[stageIndex]}
          </motion.p>
        )}

        {state === "done" && judgment && (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center gap-3 text-center"
          >
            <span className="text-xs uppercase tracking-wide text-consensus">
              Consensus Reached
            </span>
            <span className="text-sm font-medium">JUDGMENT</span>
            <StatusBadge status={judgment.decision} />
            <p className="max-w-sm text-sm text-muted-foreground">{judgment.summary}</p>
            {agreedAmount != null && (
              <p className="text-sm text-foreground">
                Provider: {((judgment.payout_bps / 10000) * agreedAmount).toFixed(2)} GEN ·
                {" "}
                Buyer: {(((10000 - judgment.payout_bps) / 10000) * agreedAmount).toFixed(2)} GEN
              </p>
            )}
            <span className="text-xs text-muted-foreground">{DECISION_LABEL[judgment.decision]}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
