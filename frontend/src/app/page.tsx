import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { WalletConnectButton } from "@/components/WalletConnectButton";

const FLOW_STEPS = [
  "Agreement",
  "Escrow",
  "Delivery",
  "Dispute",
  "Evidence",
  "Consensus",
  "Judgment",
  "Settlement",
];

export default function LandingPage() {
  return (
    <div className="flex-1 flex flex-col">
      <header className="flex items-center justify-between px-6 py-5 border-b border-border">
        <span className="text-sm font-semibold tracking-wide text-foreground">
          CourtFlow
        </span>
        <WalletConnectButton />
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-24 text-center">
        <p className="max-w-2xl text-balance text-lg text-muted-foreground mb-8">
          What happens when two agents disagree about whether a promise was
          fulfilled?
        </p>

        <h1 className="text-5xl md:text-6xl font-semibold tracking-tight text-foreground mb-4">
          CourtFlow
        </h1>

        <p className="max-w-xl text-balance text-xl text-muted-foreground mb-2">
          Trustless adjudication
        </p>
        <p className="max-w-xl text-balance text-xl text-muted-foreground mb-10">
          for agentic commerce.
        </p>

        <div className="flex items-center gap-3 text-sm text-muted-foreground mb-12 flex-wrap justify-center">
          {["Agreement", "Escrow", "Delivery", "Dispute", "Evidence", "Consensus", "Judgment"].map(
            (label, i, arr) => (
              <span key={label} className="flex items-center gap-3">
                <span>{label}</span>
                {i < arr.length - 1 && <ArrowRight size={14} className="text-border" />}
              </span>
            )
          )}
        </div>

        <div className="flex items-center gap-4">
          <Link
            href="/agreements/new"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
          >
            Create Agreement
          </Link>
          <Link
            href="/dashboard?tab=disputes"
            className="inline-flex items-center gap-2 rounded-md border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:border-primary/60 transition-colors"
          >
            Explore a Dispute
          </Link>
        </div>
      </main>

      <section className="border-t border-border px-6 py-16">
        <div className="mx-auto max-w-md flex flex-col items-center gap-3">
          {FLOW_STEPS.map((step, i) => (
            <div key={step} className="flex flex-col items-center gap-3 w-full">
              <div className="w-full rounded-md border border-border bg-surface px-4 py-3 text-center text-sm text-foreground">
                {step}
              </div>
              {i < FLOW_STEPS.length - 1 && (
                <div className="h-6 w-px bg-border" aria-hidden />
              )}
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border px-6 py-6 text-center text-xs text-muted-foreground">
        GenLayer provides the trustless judgment layer. CourtFlow provides the
        protocol around it.
      </footer>
    </div>
  );
}
