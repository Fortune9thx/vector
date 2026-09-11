"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { StatusPill } from "@/components/StatusPill";
import { SeverityMeter } from "@/components/SeverityMeter";
import { useGenLayerClient, getReadOnlyClient, readContractRetry } from "@/lib/genlayer-client";
import { useTransactionLifecycle } from "@/lib/useTransactionLifecycle";
import {
  fetchBounties,
  fetchBountyMeta,
  fetchDisclosuresByResearcher,
  fetchBountiesBySponsor,
  fetchOwner,
  fetchCollectedFees,
  withdrawFees,
} from "@/lib/vector-calls";
import { getVectorFactoryAddress, isVectorFactoryDeployed } from "@/lib/contracts";
import { formatGen, shortenAddress, timeAgo } from "@/lib/utils";
import { TransactionPanel } from "@/components/TransactionPanel";
import type { BountyMeta, DisclosureRecord } from "@/lib/vector-abi";

interface MyDisclosureRow {
  bountyAddress: string;
  bountyTitle: string;
  disclosure: DisclosureRecord;
}

export default function DashboardPage() {
  const { address: connectedAddress } = useGenLayerClient();
  const factoryAddress = getVectorFactoryAddress();

  const [myDisclosures, setMyDisclosures] = useState<MyDisclosureRow[] | null>(null);
  const [myPrograms, setMyPrograms] = useState<BountyMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Factory owner's only privileged action: withdrawing accumulated
  // register_bounty creation stakes. Fetched independently of the rest of
  // this page so a non-owner wallet never even triggers the owner/fees
  // reads.
  const { client } = useGenLayerClient();
  const ownerActions = useTransactionLifecycle(client);
  const [isOwner, setIsOwner] = useState(false);
  const [collectedFees, setCollectedFees] = useState<string | null>(null);

  const refreshOwnerFees = useCallback(() => {
    if (!factoryAddress || !connectedAddress) {
      setIsOwner(false);
      setCollectedFees(null);
      return;
    }
    const readClient = getReadOnlyClient();
    readContractRetry(() => fetchOwner(readClient, factoryAddress))
      .then((owner) => {
        const mine = owner.toLowerCase() === connectedAddress.toLowerCase();
        setIsOwner(mine);
        if (!mine) return;
        return readContractRetry(() => fetchCollectedFees(readClient, factoryAddress)).then(setCollectedFees);
      })
      .catch(() => {
        setIsOwner(false);
        setCollectedFees(null);
      });
  }, [factoryAddress, connectedAddress]);

  useEffect(() => {
    refreshOwnerFees();
  }, [refreshOwnerFees]);

  const refresh = useCallback(() => {
    if (!factoryAddress || !connectedAddress) return;
    setError(null);
    setMyDisclosures(null);
    setMyPrograms(null);
    const client = getReadOnlyClient();

    readContractRetry(() => fetchBounties(client, factoryAddress))
      .then(async (addresses) => {
        const metas = await Promise.allSettled(
          addresses.map((addr) => fetchBountyMeta(client, factoryAddress, addr))
        );
        const rows: MyDisclosureRow[] = [];
        const disclosureResults = await Promise.allSettled(
          addresses.map((addr) => fetchDisclosuresByResearcher(client, addr as `0x${string}`, connectedAddress))
        );
        addresses.forEach((addr, i) => {
          const metaResult = metas[i];
          const disclosureResult = disclosureResults[i];
          if (metaResult.status !== "fulfilled" || disclosureResult.status !== "fulfilled") return;
          for (const d of disclosureResult.value) {
            rows.push({ bountyAddress: addr, bountyTitle: metaResult.value.title, disclosure: d });
          }
        });
        setMyDisclosures(rows.sort((a, b) => parseInt(b.disclosure.submitted_at) - parseInt(a.disclosure.submitted_at)));

        const sponsoredAddresses = await readContractRetry(() =>
          fetchBountiesBySponsor(client, factoryAddress, connectedAddress)
        );
        const sponsoredMetas = await Promise.allSettled(
          sponsoredAddresses.map((addr) => fetchBountyMeta(client, factoryAddress, addr))
        );
        setMyPrograms(
          sponsoredMetas
            .filter((r): r is PromiseFulfilledResult<BountyMeta> => r.status === "fulfilled")
            .map((r) => r.value)
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load your dashboard."));
  }, [factoryAddress, connectedAddress]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!isVectorFactoryDeployed() || !factoryAddress) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24">
        <EmptyState
          title="VectorFactory not deployed yet"
          description="This deployment of the app isn't pointed at a live VectorFactory contract yet."
        />
      </div>
    );
  }

  if (!connectedAddress) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24">
        <EmptyState
          title="Connect a wallet"
          description="Your dashboard shows every disclosure you've submitted, and every bounty program you sponsor, across the whole registry."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24">
        <EmptyState title="Couldn't load your dashboard" description={error} action={<Button onClick={refresh}>Retry</Button>} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      <p className="eyebrow">Your dashboard</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
        {shortenAddress(connectedAddress)}
      </h1>

      {isOwner && (
        <section className="mt-10 paper-card flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Factory owner</p>
            <p className="mt-1.5 text-sm text-ink-soft">
              Accumulated creation stakes:{" "}
              <span className="font-semibold text-ink">
                {collectedFees === null ? "…" : `${formatGen(collectedFees)} GEN`}
              </span>
            </p>
          </div>
          {ownerActions.state.phase !== "idle" ? (
            <TransactionPanel state={ownerActions.state} onReset={ownerActions.reset} successLabel="Fees withdrawn" />
          ) : (
            <Button
              variant="outline"
              disabled={!client || !collectedFees || collectedFees === "0"}
              onClick={() =>
                // Real emit_transfer to the owner -- only actually executes
                // at FINALIZED, not ACCEPTED.
                ownerActions.run(() => withdrawFees(client!, factoryAddress!), { requireFinalized: true }).then(refreshOwnerFees)
              }
            >
              Withdraw fees
            </Button>
          )}
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-xl font-semibold text-ink">Your disclosures</h2>
        <div className="mt-5 flex flex-col gap-3">
          {myDisclosures === null ? (
            [0, 1].map((i) => <div key={i} className="h-20 animate-pulse rounded-[20px] bg-ink/5" />)
          ) : myDisclosures.length === 0 ? (
            <EmptyState
              title="No disclosures yet"
              description="Submit your first disclosure against a live bounty program."
              action={
                <Button asChild>
                  <Link href="/bounties">Explore bounties</Link>
                </Button>
              }
            />
          ) : (
            myDisclosures.map((row) => (
              <Link
                key={`${row.bountyAddress}-${row.disclosure.id}`}
                href={`/bounties/${row.bountyAddress}`}
                className="paper-card paper-card-hover flex items-center justify-between gap-4 p-5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-ink-faint">#{row.disclosure.id}</span>
                    <StatusPill status={row.disclosure.status} />
                  </div>
                  <p className="mt-1.5 truncate text-sm font-semibold text-ink">{row.disclosure.title}</p>
                  <p className="mt-1 truncate text-xs text-ink-soft">{row.bountyTitle}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <SeverityMeter severity={row.disclosure.assigned_severity || row.disclosure.claimed_severity} />
                  <span className="text-xs text-ink-faint">{timeAgo(row.disclosure.submitted_at)}</span>
                </div>
              </Link>
            ))
          )}
        </div>
      </section>

      <section className="mt-14">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-xl font-semibold text-ink">Programs you sponsor</h2>
          <Button asChild variant="outline" size="sm">
            <Link href="/create">
              <Plus className="h-3.5 w-3.5" /> New program
            </Link>
          </Button>
        </div>
        <div className="mt-5 flex flex-col gap-3">
          {myPrograms === null ? (
            [0, 1].map((i) => <div key={i} className="h-20 animate-pulse rounded-[20px] bg-ink/5" />)
          ) : myPrograms.length === 0 ? (
            <EmptyState
              title="You don't sponsor any programs yet"
              description="Open a verified disclosure program against your own live target."
              action={
                <Button asChild>
                  <Link href="/create">Create a program</Link>
                </Button>
              }
            />
          ) : (
            myPrograms.map((meta) => (
              <Link
                key={meta.address}
                href={`/bounties/${meta.address}`}
                className="paper-card paper-card-hover flex items-center justify-between gap-4 p-5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{meta.title}</p>
                  <p className="mt-1 truncate font-mono text-xs text-ink-faint">{meta.target_url}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-ink-soft">Up to {formatGen(meta.severity_payouts.critical)} GEN</span>
                  <ArrowUpRight className="h-4 w-4 text-ink-faint" />
                </div>
              </Link>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
