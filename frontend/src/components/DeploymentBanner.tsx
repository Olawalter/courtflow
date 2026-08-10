export function DeploymentBanner() {
  return (
    <div className="mx-6 mt-4 rounded-md border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-warning">
      CourtFlow isn&apos;t deployed on this network yet — set{" "}
      <code className="rounded bg-surface px-1 py-0.5 text-xs">
        NEXT_PUBLIC_COURTFLOW_ADDRESS
      </code>{" "}
      after running <code className="rounded bg-surface px-1 py-0.5 text-xs">genlayer deploy</code>.
    </div>
  );
}
