import Link from "next/link";
import { WalletConnectButton } from "@/components/WalletConnectButton";

export function TopNav() {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-border">
      <div className="flex items-center gap-6">
        <Link href="/" className="text-sm font-semibold tracking-wide text-foreground">
          CourtFlow
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
          <Link href="/dashboard" className="hover:text-foreground transition-colors">
            Overview
          </Link>
          <Link href="/dashboard?tab=agreements" className="hover:text-foreground transition-colors">
            Agreements
          </Link>
          <Link href="/dashboard?tab=disputes" className="hover:text-foreground transition-colors">
            Disputes
          </Link>
          <Link href="/dashboard?tab=reputation" className="hover:text-foreground transition-colors">
            Reputation
          </Link>
        </nav>
      </div>
      <WalletConnectButton />
    </header>
  );
}
