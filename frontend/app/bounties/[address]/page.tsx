"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { ExternalLink, Plus, Coins, Lock, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { DisclosureCard } from "@/components/DisclosureCard";
import { SubmitDisclosureDialog } from "@/components/SubmitDisclosureDialog";
import { FundPoolDialog } from "@/components/FundPoolDialog";
import { TransactionPanel } from "@/components/TransactionPanel";
import { GeometricMark, markForAddress } from "@/components/GeometricMark";
import { useGenLayerClient, getReadOnlyClient, readContractRetry } from "@/lib/genlayer-client";
import { useTransactionLifecycle } from "@/lib/useTransactionLifecycle";
import { fetchBountyInfo, fetchDisclosures, fetchDisclosure, closeBounty, withdrawUnusedPool } from "@/lib/vector-calls";
import { shortenAddress, timeAgo, formatGen } from "@/lib/utils";
import type { BountyInfo, DisclosureRecord } from "@/lib/vector-abi";

export default function BountyDetailPage() {
  const params = useParams();
  const address = params.address as `0x${string}`;
  const { client, address: connectedAddress } = useGenLayerClient();
  const sponsorActions = useTransactionLifecycle(client);

  const [info, setInfo] = useState<BountyInfo | null>(null);
  const [disclosures, setDisclosures] = useState<DisclosureRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [fundOpen, setFundOpen] = useState(false);

  const refresh = useCallback(() => {
    if (!address) return;
    setError(null);
    const readClient = getReadOnlyClient();
    // Retried, not single-shot: a bounty navigated to right after creation
    // (e.g. via "View your bounty") is a real, expected case of a freshly
    // deployed contract not being readable for a few seconds yet.
    readContractRetry(() => fetchBountyInfo(readClient, address))
      .then((i) => {
        setInfo(i);
        return readContractRetry(() => fetchDisclosures(readClient, address));
      })
      .then((ids) =>
        Promise.allSettled(ids.map((id) => readContractRetry(() => fetchDisclosure(readClient, address, id))))
      )
      .then((results) => {
        setDisclosures(
          results
            .filter((r): r is PromiseFulfilledResult<DisclosureRecord> => r.status === "fulfilled")
            .map((r) => r.value)
            .reverse()
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load this bounty."));
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24">
        <EmptyState
          title="Couldn't load this bounty"
          description={`${error} If this program was just created, it may still be propagating — this can take a little longer than usual right now.`}
          action={<Button onClick={refresh}>Retry</Button>}
        />
      </div>
    );
  }

  if (!info) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-16">
        <div className="h-10 w-2/3 animate-pulse rounded-lg bg-ink/5" />
        <div className="mt-4 h-24 w-full animate-pulse rounded-2xl bg-ink/5" />
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="h-48 animate-pulse rounded-2xl bg-ink/5" />
          <div className="h-48 animate-pulse rounded-2xl bg-ink/5" />
        </div>
      </div>
    );
  }

  const isSponsor = connectedAddress && connectedAddress.toLowerCase() === info.sponsor.toLowerCase();
  const allTerminal =
    disclosures !== null &&
    disclosures.every((d) => ["PAID", "REJECTED", "DUPLICATE", "EXPIRED"].includes(d.status));

  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="meta-pill normal-case tracking-normal">{info.status === "open" ? "Live" : "Closed"}</span>
            <span className="meta-pill font-mono normal-case tracking-normal">{shortenAddress(address)}</span>
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">{info.title}</h1>
          {info.description && <p className="mt-3 max-w-2xl text-ink-soft">{info.description}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-ink-soft">
            <a href={info.target_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-ink hover:underline">
              <ExternalLink className="h-3.5 w-3.5" /> {info.target_url}
            </a>
            <span>Sponsor {shortenAddress(info.sponsor)}</span>
            <span>Opened {timeAgo(info.created_at)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-center">
          <div className="yellow-block flex h-24 w-24 items-center justify-center">
            <GeometricMark kind={markForAddress(address)} className="h-14 w-14 text-ink" />
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="paper-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Pool remaining</p>
          <p className="mt-2 text-2xl font-bold text-ink">{formatGen(info.pool_remaining)} GEN</p>
        </div>
        <div className="paper-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Available to reserve</p>
          <p className="mt-2 text-2xl font-bold text-ink">{formatGen(info.available_wei)} GEN</p>
          <p className="mt-1 text-xs text-ink-soft">
            {formatGen(info.reserved_wei)} GEN already committed to pending/verified disclosures
          </p>
        </div>
        <div className="paper-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Disclosure bond</p>
          <p className="mt-2 text-2xl font-bold text-ink">{formatGen(info.disclosure_bond)} GEN</p>
        </div>
        <div className="paper-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Disclosures</p>
          <p className="mt-2 text-2xl font-bold text-ink">{info.disclosure_count}</p>
        </div>
      </div>

      <div className="mt-6 paper-card p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Payouts by severity</p>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(["critical", "high", "medium", "low"] as const).map((level) => (
            <div key={level}>
              <p className="text-xs capitalize text-ink-soft">{level}</p>
              <p className="mt-1 font-semibold text-ink">{formatGen(info.severity_payouts[level])} GEN</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 flex flex-wrap gap-2">
        {info.status === "open" && (
          <Button onClick={() => setSubmitOpen(true)}>
            <Plus className="h-4 w-4" /> Submit disclosure
          </Button>
        )}
        <Button variant="outline" onClick={() => setFundOpen(true)}>
          <Coins className="h-4 w-4" /> Fund pool
        </Button>
        {isSponsor && info.status === "open" && (
          <Button
            variant="ghost"
            onClick={() => sponsorActions.run(() => closeBounty(client!, address)).then(refresh)}
          >
            <Lock className="h-4 w-4" /> Close program
          </Button>
        )}
        {isSponsor && info.status === "closed" && allTerminal && (
          <Button
            variant="ghost"
            onClick={() =>
              // A real emit_transfer to the sponsor -- GenLayer EOA value
              // transfers only actually execute at FINALIZED, not ACCEPTED.
              sponsorActions.run(() => withdrawUnusedPool(client!, address), { requireFinalized: true }).then(refresh)
            }
          >
            <Wallet className="h-4 w-4" /> Withdraw unused pool
          </Button>
        )}
      </div>

      {sponsorActions.state.phase !== "idle" && (
        <div className="mt-4 max-w-sm">
          <TransactionPanel state={sponsorActions.state} onReset={sponsorActions.reset} successLabel="Confirmed on-chain" />
        </div>
      )}

      <div className="mt-12">
        <p className="eyebrow">Disclosures</p>
        <h2 className="mt-3 text-2xl font-bold tracking-tight text-ink">
          {disclosures?.length ?? 0} submitted
        </h2>

        <div className="mt-6 flex flex-col gap-3">
          {disclosures === null ? (
            [0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-[20px] bg-ink/5" />)
          ) : disclosures.length === 0 ? (
            <EmptyState
              title="No disclosures yet"
              description="Be the first researcher to submit a disclosure against this program's live target."
              action={
                info.status === "open" ? (
                  <Button onClick={() => setSubmitOpen(true)}>
                    <Plus className="h-4 w-4" /> Submit disclosure
                  </Button>
                ) : undefined
              }
            />
          ) : (
            disclosures.map((d, i) => (
              <motion.div
                key={d.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: Math.min(i, 8) * 0.04 }}
              >
                <DisclosureCard
                  bountyAddress={address}
                  disclosure={d}
                  connectedAddress={connectedAddress}
                  disclosureBondWei={info.disclosure_bond}
                  onRefresh={refresh}
                />
              </motion.div>
            ))
          )}
        </div>
      </div>

      <SubmitDisclosureDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        bountyAddress={address}
        bondWei={info.disclosure_bond}
        onSuccess={refresh}
      />
      <FundPoolDialog open={fundOpen} onOpenChange={setFundOpen} bountyAddress={address} onSuccess={refresh} />
    </div>
  );
}
