"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { TopNav } from "@/components/TopNav";
import { DeploymentBanner } from "@/components/DeploymentBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { useAgreements, useReputation } from "@/lib/genlayer/hooks";
import { useWallet } from "@/lib/genlayer/wallet";
import { fulfillmentRate } from "@/lib/genlayer/types";
import { weiToGen } from "@/lib/genlayer/contract";

const TABS = ["overview", "agreements", "disputes", "reputation"] as const;
type Tab = (typeof TABS)[number];

function Card({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function isTab(value: string | null): value is Tab {
  return (TABS as readonly string[]).includes(value ?? "");
}

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Single source of truth is the URL, so links like `/dashboard?tab=disputes`
  // (e.g. the landing page's "Explore a Dispute" CTA) actually land on the
  // right tab instead of always defaulting to Overview.
  const requestedTab = searchParams.get("tab");
  const tab: Tab = isTab(requestedTab) ? requestedTab : "overview";
  const setTab = (next: Tab) => router.push(`/dashboard?tab=${next}`);

  const { data: agreements, loading, error, deployed } = useAgreements();
  const address = useWallet((s) => s.address);
  const { data: reputation } = useReputation(address);

  const list = useMemo(() => Object.values(agreements ?? {}), [agreements]);

  const counts = useMemo(() => {
    const active = list.filter((a) => ["ACTIVE", "FUNDED"].includes(a.status)).length;
    const inEscrow = list.filter((a) => a.escrow_deposited > 0).length;
    const underReview = list.filter((a) => ["DISPUTED", "UNDER_REVIEW"].includes(a.status)).length;
    const finalized = list.filter((a) => ["SETTLED", "CANCELLED", "TIMED_OUT"].includes(a.status)).length;
    return { active, inEscrow, underReview, finalized };
  }, [list]);

  const disputed = list.filter((a) => ["DISPUTED", "UNDER_REVIEW", "JUDGED"].includes(a.status));

  return (
    <div className="flex-1 flex flex-col">
      <TopNav />
      {!deployed && <DeploymentBanner />}

      <div className="px-6 pt-6">
        <div className="flex gap-1 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm capitalize border-b-2 -mb-px transition-colors ${
                tab === t
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 px-6 py-6">
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-dispute">{error}</p>}

        {tab === "overview" && !loading && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card label="Active Agreements" value={counts.active} />
            <Card label="In Escrow" value={counts.inEscrow} />
            <Card label="Under Review" value={counts.underReview} />
            <Card label="Finalized" value={counts.finalized} />
          </div>
        )}

        {tab === "agreements" && (
          <div className="flex flex-col gap-2">
            {list.length === 0 && !loading && (
              <p className="text-sm text-muted-foreground">No agreements yet.</p>
            )}
            {list.map((a) => (
              <Link
                key={a.agreement_id}
                href={`/agreements/${a.agreement_id}`}
                className="flex items-center justify-between rounded-md border border-border bg-surface px-4 py-3 hover:border-primary/50 transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{a.agreement_id}</p>
                  <p className="text-xs text-muted-foreground">{weiToGen(a.agreed_amount)} GEN</p>
                </div>
                <StatusBadge status={a.status} />
              </Link>
            ))}
          </div>
        )}

        {tab === "disputes" && (
          <div className="flex flex-col gap-2">
            {disputed.length === 0 && !loading && (
              <p className="text-sm text-muted-foreground">No disputes yet.</p>
            )}
            {disputed.map((a) => (
              <Link
                key={a.agreement_id}
                href={`/agreements/${a.agreement_id}`}
                className="flex items-center justify-between rounded-md border border-border bg-surface px-4 py-3 hover:border-dispute/50 transition-colors"
              >
                <p className="text-sm font-medium text-foreground">{a.agreement_id}</p>
                <StatusBadge status={a.status} />
              </Link>
            ))}
          </div>
        )}

        {tab === "reputation" && (
          <div className="max-w-md">
            {!address && (
              <p className="text-sm text-muted-foreground">Connect a wallet to see your reputation.</p>
            )}
            {address && reputation && (
              <div className="grid grid-cols-2 gap-4">
                <Card
                  label="Fulfillment Rate"
                  value={
                    fulfillmentRate(reputation) == null
                      ? "—"
                      : `${fulfillmentRate(reputation)}%`
                  }
                />
                <Card label="Completed" value={reputation.completed} />
                <Card
                  label="Disputes Won"
                  value={
                    reputation.disputes_opened === 0
                      ? "—"
                      : `${Math.round(
                          (reputation.disputes_won / reputation.disputes_opened) * 100
                        )}%`
                  }
                />
                <Card label="Late Deliveries" value={reputation.late_deliveries} />
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
