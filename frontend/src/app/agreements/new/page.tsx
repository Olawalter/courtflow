"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { TopNav } from "@/components/TopNav";
import { NetworkBanner } from "@/components/NetworkBanner";
import { useWallet } from "@/lib/genlayer/wallet";
import {
  writeCourtFlow,
  waitForCourtFlowTx,
  toCalldataAddress,
  genToWei,
} from "@/lib/genlayer/contract";

const DEFAULT_TERMS = `Create an original company logo.

Requirements:
1. Original artwork.
2. No copyrighted material.
3. Follow supplied brand guidelines.
4. PNG delivery.
5. SVG delivery.
6. Editable/source file.
7. Delivery before the agreed deadline.

Payment: 500 GEN
Dispute window: 24 hours after delivery.`;

const schema = z.object({
  agreementId: z.string().min(1, "Required").regex(/^[a-zA-Z0-9-_]+$/, "Letters, numbers, - and _ only"),
  provider: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid 0x address"),
  terms: z.string().min(1, "Required"),
  agreedAmount: z.coerce.number().positive("Must be > 0"),
  deadline: z.string().min(1, "Required"),
  disputeWindowHours: z.coerce.number().positive("Must be > 0"),
});

type FormInput = z.input<typeof schema>;
type FormValues = z.output<typeof schema>;

export default function NewAgreementPage() {
  const router = useRouter();
  const client = useWallet((s) => s.client);
  const address = useWallet((s) => s.address);
  const connect = useWallet((s) => s.connect);
  const [submitting, setSubmitting] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      terms: DEFAULT_TERMS,
      agreedAmount: 500,
      disputeWindowHours: 24,
    },
  });

  const onSubmit = async (values: FormValues) => {
    if (!client) {
      setTxError("Connect a wallet first.");
      return;
    }
    setSubmitting(true);
    setTxError(null);
    try {
      const deadlineIso = new Date(values.deadline).toISOString();
      const hash = await writeCourtFlow(client, "create_agreement", [
        values.agreementId,
        toCalldataAddress(values.provider),
        values.terms,
        genToWei(values.agreedAmount),
        deadlineIso,
        values.disputeWindowHours * 3600,
      ]);
      await waitForCourtFlowTx(client, hash);
      router.push(`/agreements/${values.agreementId}`);
    } catch (err) {
      setTxError(err instanceof Error ? err.message : "Transaction failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      <TopNav />
      <main className="flex-1 px-6 py-10">
        <div className="mx-auto max-w-xl">
          <h1 className="text-2xl font-semibold text-foreground mb-1">Create Agreement</h1>
          <p className="text-sm text-muted-foreground mb-6">
            You&apos;ll be the buyer. The provider accepts before escrow can be funded.
          </p>

          {!address && (
            <button
              onClick={connect}
              className="mb-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
            >
              Connect wallet to continue
            </button>
          )}

          <NetworkBanner />

          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
            <Field label="Agreement ID" error={errors.agreementId?.message}>
              <input
                {...register("agreementId")}
                placeholder="logo-design-001"
                className="input"
              />
            </Field>

            <Field label="Provider address" error={errors.provider?.message}>
              <input {...register("provider")} placeholder="0x…" className="input" />
            </Field>

            <Field label="Terms" error={errors.terms?.message}>
              <textarea {...register("terms")} rows={10} className="input font-mono text-xs" />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Agreed amount (GEN)" error={errors.agreedAmount?.message}>
                <input
                  type="number"
                  step="any"
                  {...register("agreedAmount")}
                  className="input"
                />
              </Field>
              <Field label="Dispute window (hours)" error={errors.disputeWindowHours?.message}>
                <input
                  type="number"
                  {...register("disputeWindowHours")}
                  className="input"
                />
              </Field>
            </div>

            <Field label="Delivery deadline" error={errors.deadline?.message}>
              <input type="datetime-local" {...register("deadline")} className="input" />
            </Field>

            {txError && <p className="text-sm text-dispute">{txError}</p>}

            <button
              type="submit"
              disabled={submitting || !address}
              className="rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {submitting ? "Submitting…" : "Create Agreement"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-foreground">{label}</span>
      {children}
      {error && <span className="text-xs text-dispute">{error}</span>}
    </label>
  );
}
