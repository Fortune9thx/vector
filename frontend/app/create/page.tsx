"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/EmptyState";
import { TransactionPanel } from "@/components/TransactionPanel";
import { useGenLayerClient, getReadOnlyClient, readContractRetry } from "@/lib/genlayer-client";
import { useTransactionLifecycle } from "@/lib/useTransactionLifecycle";
import { createBounty, fetchBounties, fetchCreationStake, waitForNewBounty } from "@/lib/vector-calls";
import { getVectorFactoryAddress, isVectorFactoryDeployed } from "@/lib/contracts";
import { cn, formatGen, parseGenToWei } from "@/lib/utils";

const STEP_LABELS = ["Target", "Payouts", "Review & open"];

export default function CreateBountyPage() {
  const router = useRouter();
  const { client } = useGenLayerClient();
  const { state, run, reset } = useTransactionLifecycle(client);

  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [critical, setCritical] = useState("2");
  const [high, setHigh] = useState("1");
  const [medium, setMedium] = useState("0.5");
  const [low, setLow] = useState("0.1");
  const [bond, setBond] = useState("0.05");

  const [creationStake, setCreationStake] = useState<string | null>(null);
  const [creationStakeError, setCreationStakeError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const factoryAddress = getVectorFactoryAddress();

  function loadCreationStake() {
    if (!factoryAddress) return;
    setCreationStakeError(null);
    // Retried: this value is never cosmetic -- it's the exact `value` sent
    // with create_bounty. A silent fallback to "0" here would both mislead
    // the Review step AND submit a real transaction with 0 GEN attached,
    // which the contract then correctly rejects for insufficient stake -- a
    // confusing failure with no visible cause. Never guess this value; show
    // a real error instead.
    readContractRetry(() => fetchCreationStake(getReadOnlyClient(), factoryAddress))
      .then(setCreationStake)
      .catch(() => setCreationStakeError("Couldn't load the creation stake from the network."));
  }

  useEffect(() => {
    loadCreationStake();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factoryAddress]);

  if (!isVectorFactoryDeployed() || !factoryAddress) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24">
        <EmptyState
          title="VectorFactory not deployed yet"
          description="This deployment of the app isn't pointed at a live VectorFactory contract yet, so new bounty programs can't be opened here. Check back once the contract is live."
        />
      </div>
    );
  }

  function validateStep(current: number): string | null {
    if (current === 0) {
      if (!title.trim()) return "Give this bounty program a title.";
      if (!/^https?:\/\//i.test(targetUrl.trim())) return "Target URL must start with http:// or https://";
    }
    if (current === 1) {
      const values = [critical, high, medium, low, bond];
      for (const v of values) {
        if (!/^\d+(\.\d+)?$/.test(v.trim()) || parseFloat(v) <= 0) {
          return "Every payout and the disclosure bond must be a positive number.";
        }
      }
      if (!(parseFloat(critical) >= parseFloat(high) && parseFloat(high) >= parseFloat(medium) && parseFloat(medium) >= parseFloat(low))) {
        return "Payouts must satisfy critical ≥ high ≥ medium ≥ low.";
      }
    }
    return null;
  }

  function goNext() {
    const err = validateStep(step);
    if (err) {
      setStepError(err);
      return;
    }
    setStepError(null);
    setStep((s) => Math.min(s + 1, STEP_LABELS.length - 1));
  }

  function goBack() {
    setStepError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleSubmit() {
    if (!client || !factoryAddress || creationStake === null) return;
    const stakeWei = BigInt(creationStake);
    const beforeBountiesPromise = fetchBounties(getReadOnlyClient(), factoryAddress).catch(() => []);

    await run(
      () =>
        createBounty(
          client,
          factoryAddress,
          title.trim(),
          description.trim(),
          targetUrl.trim(),
          parseGenToWei(critical).toString(),
          parseGenToWei(high).toString(),
          parseGenToWei(medium).toString(),
          parseGenToWei(low).toString(),
          parseGenToWei(bond).toString(),
          stakeWei
        ),
      { requireFinalized: true }
    );
    setResolving(true);
    try {
      const beforeBounties = await beforeBountiesPromise;
      const newAddress = await waitForNewBounty(getReadOnlyClient(), factoryAddress, beforeBounties.length);
      setResolvedAddress(newAddress);
    } catch {
      // Non-fatal: the program was almost certainly created (tx succeeded) --
      // just couldn't confirm the exact address to auto-redirect to yet.
    } finally {
      setResolving(false);
    }
  }

  const busy = state.phase === "submitting" || state.phase === "polling";

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <p className="eyebrow">Open a bounty</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
        Put a real target behind a verified bounty.
      </h1>

      {state.phase === "idle" && (
        <div className="mt-8 flex items-center gap-2">
          {STEP_LABELS.map((label, i) => (
            <div key={label} className="flex flex-1 items-center gap-2">
              <div
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                  i < step
                    ? "bg-ink text-paper"
                    : i === step
                    ? "border-2 border-ink text-ink"
                    : "border border-border text-ink-faint"
                )}
              >
                {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span className={cn("hidden text-sm sm:block", i === step ? "font-medium text-ink" : "text-ink-faint")}>
                {label}
              </span>
              {i < STEP_LABELS.length - 1 && <div className="h-px flex-1 bg-border" />}
            </div>
          ))}
        </div>
      )}

      <div className="mt-10">
        {state.phase !== "idle" ? (
          <div className="flex flex-col items-center gap-6">
            <TransactionPanel state={state} successLabel="Bounty program is live" />
            {state.phase === "success" && (
              <div className="flex flex-col items-center gap-3">
                {resolving && <p className="text-sm text-ink-soft">Resolving your new bounty address…</p>}
                {resolvedAddress ? (
                  <Button onClick={() => router.push(`/bounties/${resolvedAddress}`)}>
                    View your bounty <ArrowRight className="h-4 w-4" />
                  </Button>
                ) : (
                  !resolving && (
                    <Button variant="outline" onClick={() => router.push("/bounties")}>
                      Go to Bounties
                    </Button>
                  )
                )}
              </div>
            )}
            {state.phase === "error" && (
              <Button
                variant="outline"
                onClick={() => {
                  reset();
                  setResolvedAddress(null);
                }}
              >
                Try again
              </Button>
            )}
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.25 }}
            >
              {step === 0 && (
                <div className="paper-card p-6">
                  <h2 className="text-lg font-semibold text-ink">What are researchers verifying against?</h2>
                  <p className="mt-1 text-sm text-ink-soft">
                    Validators fetch this exact URL fresh at every triage — point it at the real,
                    live surface you want tested.
                  </p>
                  <div className="mt-5 flex flex-col gap-4">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-ink-soft">Program title</label>
                      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Acme API Security Program" maxLength={140} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-ink-soft">Description (optional)</label>
                      <Textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Scope, exclusions, anything researchers should know before submitting."
                        maxLength={2000}
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-ink-soft">Target URL</label>
                      <Input
                        value={targetUrl}
                        onChange={(e) => setTargetUrl(e.target.value)}
                        placeholder="https://app.example.com"
                      />
                    </div>
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="paper-card p-6">
                  <h2 className="text-lg font-semibold text-ink">Set payouts and the disclosure bond</h2>
                  <p className="mt-1 text-sm text-ink-soft">
                    All amounts in GEN. Payouts must satisfy critical ≥ high ≥ medium ≥ low. The
                    bond is refunded on any genuine, verified, or unverifiable outcome — only a
                    rejected (bad-faith) disclosure forfeits it to your pool.
                  </p>
                  <div className="mt-5 grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-ink-soft">Critical</label>
                      <Input value={critical} onChange={(e) => setCritical(e.target.value)} placeholder="2" />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-ink-soft">High</label>
                      <Input value={high} onChange={(e) => setHigh(e.target.value)} placeholder="1" />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-ink-soft">Medium</label>
                      <Input value={medium} onChange={(e) => setMedium(e.target.value)} placeholder="0.5" />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-ink-soft">Low</label>
                      <Input value={low} onChange={(e) => setLow(e.target.value)} placeholder="0.1" />
                    </div>
                  </div>
                  <div className="mt-4">
                    <label className="mb-1.5 block text-xs font-medium text-ink-soft">Disclosure bond</label>
                    <Input value={bond} onChange={(e) => setBond(e.target.value)} placeholder="0.05" />
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="paper-card p-6">
                  <h2 className="text-lg font-semibold text-ink">Review</h2>
                  <dl className="mt-5 flex flex-col gap-4 text-sm">
                    <div>
                      <dt className="text-ink-faint">Title</dt>
                      <dd className="mt-1 text-ink">{title}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-faint">Target</dt>
                      <dd className="mt-1 truncate font-mono text-xs text-ink">{targetUrl}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-faint">Payouts (critical / high / medium / low)</dt>
                      <dd className="mt-1 text-ink">
                        {critical} / {high} / {medium} / {low} GEN
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-faint">Disclosure bond</dt>
                      <dd className="mt-1 text-ink">{bond} GEN</dd>
                    </div>
                    <div>
                      <dt className="text-ink-faint">Creation stake (paid now)</dt>
                      <dd className="mt-1 font-semibold text-ink">
                        {creationStakeError ? (
                          <span className="flex items-center gap-2 text-sm font-normal text-ink">
                            {creationStakeError}
                            <button onClick={loadCreationStake} className="font-medium underline underline-offset-2">
                              Retry
                            </button>
                          </span>
                        ) : creationStake === null ? (
                          <span className="inline-block h-5 w-16 animate-pulse rounded bg-ink/10 align-middle" />
                        ) : (
                          `${formatGen(creationStake)} GEN`
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {stepError && state.phase === "idle" && <p className="mt-4 text-sm text-ink">{stepError}</p>}

      {state.phase === "idle" && (
        <div className="mt-8 flex items-center justify-between">
          <Button variant="ghost" onClick={goBack} disabled={step === 0}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          {step < STEP_LABELS.length - 1 ? (
            <Button onClick={goNext}>
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={!client || busy || creationStake === null}>
              {!client
                ? "Connect a wallet to continue"
                : creationStake === null
                ? "Waiting for creation stake…"
                : "Open this bounty"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
