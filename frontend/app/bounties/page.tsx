"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BountyCard } from "@/components/BountyCard";
import { EmptyState } from "@/components/EmptyState";
import { getReadOnlyClient, readContractRetry } from "@/lib/genlayer-client";
import { fetchBounties, fetchBountyMeta, fetchBountyInfo } from "@/lib/vector-calls";
import { getVectorFactoryAddress, isVectorFactoryDeployed } from "@/lib/contracts";
import type { BountyMeta } from "@/lib/vector-abi";

interface Row {
  meta: BountyMeta;
  status: "open" | "closed";
}

export default function BountiesPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");
  const factoryAddress = getVectorFactoryAddress();

  useEffect(() => {
    if (!factoryAddress) {
      setRows([]);
      return;
    }
    let cancelled = false;
    const client = getReadOnlyClient();

    (async () => {
      try {
        const addresses = await readContractRetry(() => fetchBounties(client, factoryAddress));
        const results = await Promise.allSettled(
          addresses.map(async (addr) => {
            const [meta, info] = await Promise.all([
              fetchBountyMeta(client, factoryAddress, addr),
              fetchBountyInfo(client, addr as `0x${string}`),
            ]);
            return { meta, status: info.status } satisfies Row;
          })
        );
        if (cancelled) return;
        setRows(
          results
            .filter((r): r is PromiseFulfilledResult<Row> => r.status === "fulfilled")
            .map((r) => r.value)
            .reverse()
        );
      } catch {
        if (!cancelled) setRows([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [factoryAddress]);

  const filtered = rows?.filter((r) => filter === "all" || r.status === filter) ?? null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">All programs</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">Bounty programs</h1>
        </div>
        <Button asChild>
          <Link href="/create">
            <Plus className="h-4 w-4" /> Create a program
          </Link>
        </Button>
      </div>

      <div className="mt-8 flex items-center gap-2">
        {(["all", "open", "closed"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={
              filter === key
                ? "meta-pill bg-ink text-paper normal-case tracking-normal"
                : "meta-pill hover:bg-ink/10 normal-case tracking-normal"
            }
          >
            {key === "all" ? "All" : key === "open" ? "Live" : "Closed"}
          </button>
        ))}
      </div>

      <div className="mt-8">
        {filtered === null ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="aspect-[4/3] animate-pulse rounded-[20px] bg-ink/5 sm:aspect-[16/10]" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={!isVectorFactoryDeployed() ? "VectorFactory not deployed yet" : "No programs match this filter"}
            description={
              !isVectorFactoryDeployed()
                ? "This deployment of the app isn't pointed at a live VectorFactory contract yet."
                : "Try a different filter, or open the first program yourself."
            }
            action={
              isVectorFactoryDeployed() ? (
                <Button asChild variant="outline">
                  <Link href="/create">Create a program</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((row, i) => (
              <BountyCard key={row.meta.address} meta={row.meta} status={row.status} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
