"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatBlock } from "@/components/StatBlock";
import { BountyCard } from "@/components/BountyCard";
import { ScanRing } from "@/components/ScanRing";
import { EmptyState } from "@/components/EmptyState";
import { getReadOnlyClient, readContractRetry } from "@/lib/genlayer-client";
import { fetchBounties, fetchBountyMeta, fetchBountyInfo } from "@/lib/vector-calls";
import { getVectorFactoryAddress, isVectorFactoryDeployed } from "@/lib/contracts";
import { formatGen } from "@/lib/utils";
import type { BountyMeta } from "@/lib/vector-abi";

const STEPS = [
  {
    n: "01",
    title: "Submit a disclosure",
    body: "A researcher stakes a bond against a live bounty program, describing the vulnerability, reproduction steps, and the exact target reference.",
  },
  {
    n: "02",
    title: "Triage fetches the real target",
    body: "The contract itself fetches the live public target fresh, every time — never the researcher's own account of what it shows.",
  },
  {
    n: "03",
    title: "Validators independently re-verify",
    body: "Every validator refetches the target and reasons from scratch under the Equivalence Principle. A decision only lands if they agree.",
  },
  {
    n: "04",
    title: "Bond returns, payout unlocks",
    body: "Genuine, verified disclosures return the bond and open a claimable payout. Bad-faith submissions forfeit theirs to the pool.",
  },
];

interface HomeStats {
  bountyCount: number;
  poolTotalWei: bigint;
  disclosureTotal: number;
}

export default function LandingPage() {
  const [featured, setFeatured] = useState<BountyMeta[] | null>(null);
  const [stats, setStats] = useState<HomeStats | null>(null);
  const factoryAddress = getVectorFactoryAddress();

  useEffect(() => {
    if (!factoryAddress) {
      setFeatured([]);
      setStats({ bountyCount: 0, poolTotalWei: 0n, disclosureTotal: 0 });
      return;
    }
    let cancelled = false;
    const client = getReadOnlyClient();

    (async () => {
      try {
        const addresses = await readContractRetry(() => fetchBounties(client, factoryAddress));
        const preview = addresses.slice(0, 3);
        const metas = await Promise.allSettled(
          preview.map((addr) => fetchBountyMeta(client, factoryAddress, addr))
        );
        if (cancelled) return;
        setFeatured(metas.filter((m) => m.status === "fulfilled").map((m) => m.value));

        const infos = await Promise.allSettled(
          addresses.map((addr) => fetchBountyInfo(client, addr as `0x${string}`))
        );
        if (cancelled) return;
        let poolTotalWei = 0n;
        let disclosureTotal = 0;
        for (const result of infos) {
          if (result.status !== "fulfilled") continue;
          poolTotalWei += BigInt(result.value.pool_remaining || "0");
          disclosureTotal += result.value.disclosure_count;
        }
        setStats({ bountyCount: addresses.length, poolTotalWei, disclosureTotal });
      } catch {
        if (!cancelled) {
          setFeatured([]);
          setStats({ bountyCount: 0, poolTotalWei: 0n, disclosureTotal: 0 });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [factoryAddress]);

  return (
    <div className="relative">
      {/* ---------------------------------------------------------------- */}
      {/* Hero                                                              */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-16 sm:pt-24 lg:grid-cols-[1.1fr_0.9fr] lg:gap-8">
        <div>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="eyebrow"
          >
            Live on GenLayer Studio Devnet
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.08 }}
            className="mt-5 text-5xl font-bold leading-[1.02] tracking-tight text-ink sm:text-6xl lg:text-7xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Disclosure,
            <br />
            verified by
            <br />
            consensus.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.16 }}
            className="mt-6 max-w-lg text-base text-ink-soft sm:text-lg"
          >
            Security researchers disclose vulnerabilities against a live public target.
            GenLayer validators independently fetch that target and verify severity before
            any bounty pays out — no centralized triage team, ever.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.24 }}
            className="mt-9 flex flex-wrap items-center gap-3"
          >
            <Button asChild size="lg">
              <Link href="/bounties">
                Explore bounties <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="dark" size="lg">
              <Link href="/create">Create a program</Link>
            </Button>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="mx-auto w-full max-w-[320px]"
        >
          <ScanRing className="w-full" />
        </motion.div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Stats                                                             */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <p className="eyebrow">Protocol stats</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <StatBlock value={stats?.bountyCount ?? 0} label="Live bounty programs" />
          <StatBlock
            value={stats ? Number(formatGen(stats.poolTotalWei, 2)) : 0}
            label="GEN held in escrow pools"
            formatter={(n) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          />
          <StatBlock value={stats?.disclosureTotal ?? 0} label="Disclosures submitted" />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* How it works                                                      */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <p className="eyebrow">How it works</p>
        <h2 className="mt-3 max-w-xl text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Trustless verification, not a review queue.
        </h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <motion.div
              key={step.n}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="paper-card p-6"
            >
              <span className="font-mono text-xs text-ink-faint">{step.n}</span>
              <h3 className="mt-3 text-base font-semibold text-ink">{step.title}</h3>
              <p className="mt-2 text-sm text-ink-soft">{step.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Featured bounty programs                                          */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Active programs</p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              Bounties open right now.
            </h2>
          </div>
          <Link href="/bounties" className="hidden shrink-0 items-center gap-1 text-sm font-semibold text-ink hover:underline sm:flex">
            View all <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-8">
          {featured === null ? (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="aspect-[4/3] animate-pulse rounded-[20px] bg-ink/5 sm:aspect-[16/10]" />
              ))}
            </div>
          ) : featured.length === 0 ? (
            <EmptyState
              title={isVectorFactoryDeployed() ? "No bounty programs yet" : "VectorFactory not deployed yet"}
              description={
                isVectorFactoryDeployed()
                  ? "Be the first sponsor to open a verified disclosure program."
                  : "This deployment of the app isn't pointed at a live VectorFactory contract yet."
              }
              action={
                isVectorFactoryDeployed() ? (
                  <Button asChild>
                    <Link href="/create">Create the first program</Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {featured.map((meta, i) => (
                <BountyCard key={meta.address} meta={meta} index={i} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Principle strip                                                   */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="paper-card flex flex-col gap-6 p-8 sm:flex-row sm:items-center sm:p-10">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ink">
            <span className="h-2.5 w-2.5 rounded-full bg-yellow" />
          </div>
          <div>
            <p className="text-lg font-semibold text-ink sm:text-xl">
              &ldquo;No centralized triage team. The verification itself is the trustless part.&rdquo;
            </p>
            <p className="mt-2 text-sm text-ink-soft">
              Every triage decision is re-derived independently by every validator, bound to
              evidence sliced from the real fetched target — never a self-reported claim.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Full-bleed CTA                                                    */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="yellow-block relative overflow-hidden p-10 sm:p-16">
          <div className="relative z-10 max-w-xl">
            <h2 className="text-3xl font-bold leading-tight tracking-tight text-ink sm:text-5xl">
              Turn disclosure into
              <br />
              verified truth.
            </h2>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild variant="dark" size="lg">
                <Link href="/create">Create a bounty program</Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="border-ink">
                <Link href="/bounties">Submit a disclosure</Link>
              </Button>
            </div>
          </div>
          <div className="pointer-events-none absolute -right-16 -top-16 opacity-25 sm:-right-8 sm:-top-8 sm:opacity-100">
            <ScanRing className="h-64 w-64 sm:h-80 sm:w-80" />
          </div>
        </div>
      </section>
    </div>
  );
}
