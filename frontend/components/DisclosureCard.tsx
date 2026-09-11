"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Search, Gavel, Coins, Clock, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/StatusPill";
import { SeverityMeter } from "@/components/SeverityMeter";
import { TransactionPanel } from "@/components/TransactionPanel";
import { ChallengeDuplicateDialog } from "@/components/ChallengeDuplicateDialog";
import { useGenLayerClient, getReadOnlyClient, readContractRetry } from "@/lib/genlayer-client";
import { useTransactionLifecycle } from "@/lib/useTransactionLifecycle";
import { triage, resolveDuplicate, finalizePayout, claimPayout, expireDisclosure, expireUnclaimedPayout, fetchClaimable } from "@/lib/vector-calls";
import {
  DUPLICATE_CHALLENGE_WINDOW_SECONDS,
  PAYOUT_CLAIM_TIMEOUT_SECONDS,
  type DisclosureRecord,
} from "@/lib/vector-abi";
import { formatGen, shortenAddress, timeAgo } from "@/lib/utils";

export function DisclosureCard({
  bountyAddress,
  disclosure,
  connectedAddress,
  onRefresh,
}: {
  bountyAddress: `0x${string}`;
  disclosure: DisclosureRecord;
  connectedAddress?: `0x${string}`;
  onRefresh: () => void;
}) {
  const { client } = useGenLayerClient();
  const { state, run, reset } = useTransactionLifecycle(client);
  const [expanded, setExpanded] = useState(false);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [claimable, setClaimable] = useState<string | null>(null);

  const isOwnDisclosure =
    connectedAddress && connectedAddress.toLowerCase() === disclosure.researcher.toLowerCase();

  useEffect(() => {
    if (disclosure.status !== "PAYOUT_PENDING" || !connectedAddress) {
      setClaimable(null);
      return;
    }
    let cancelled = false;
    readContractRetry(() => fetchClaimable(getReadOnlyClient(), bountyAddress, disclosure.id, connectedAddress))
      .then((v) => !cancelled && setClaimable(v))
      .catch(() => !cancelled && setClaimable(null));
    return () => {
      cancelled = true;
    };
  }, [disclosure.status, disclosure.id, connectedAddress, bountyAddress]);

  const now = Math.floor(Date.now() / 1000);
  const canExpire =
    (disclosure.status === "PENDING" || disclosure.status === "TRIAGING") &&
    now >= parseInt(disclosure.expire_after, 10);
  const challengeWindowOpen =
    disclosure.status === "VERIFIED" && now < parseInt(disclosure.challenge_window_ends_at, 10);
  const canFinalize =
    disclosure.status === "VERIFIED" && now >= parseInt(disclosure.challenge_window_ends_at, 10);
  const canClaim =
    disclosure.status === "PAYOUT_PENDING" && isOwnDisclosure && claimable !== null && claimable !== "0";
  // Bounded liveness backstop -- see docs/AUDIT.md. Permissionless (not
  // researcher-only): the whole point is unblocking the sponsor when the
  // researcher never returns, so anyone should be able to trigger it once
  // it's genuinely eligible.
  const canExpireUnclaimedPayout =
    disclosure.status === "PAYOUT_PENDING" &&
    now >= parseInt(disclosure.payout_pending_at, 10) + PAYOUT_CLAIM_TIMEOUT_SECONDS;

  const busy = state.phase === "submitting" || state.phase === "polling";

  // triage/claimPayout/expireDisclosure can each trigger a real emit_transfer
  // (bond refund or payout) inside the contract -- GenLayer EOA-directed
  // value transfers only actually execute at true FINALIZED, not ACCEPTED
  // (confirmed platform behavior: a balance did not move on a transfer whose
  // tx had already reached ACCEPTED/READY_TO_FINALIZE). Reporting "Confirmed
  // on-chain" before that would be a false success on a fund movement.
  // finalizePayout/resolveDuplicate never move value, so ACCEPTED is fine.
  function act(action: () => Promise<`0x${string}`>, requireFinalized = false) {
    run(action, { requireFinalized }).then(() => onRefresh());
  }

  return (
    <div className="paper-card overflow-hidden">
      <button onClick={() => setExpanded((v) => !v)} className="flex w-full items-start justify-between gap-4 p-5 text-left">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-ink-faint">#{disclosure.id}</span>
            <StatusPill status={disclosure.status} />
          </div>
          <h4 className="mt-2 truncate text-base font-semibold text-ink">{disclosure.title}</h4>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
            <span className="font-mono">{shortenAddress(disclosure.researcher)}</span>
            <span>{timeAgo(disclosure.submitted_at)}</span>
            <SeverityMeter severity={disclosure.assigned_severity || disclosure.claimed_severity} />
          </div>
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-ink-faint transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-border"
          >
            <div className="flex flex-col gap-4 p-5">
              {disclosure.description && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Description</p>
                  <p className="mt-1 text-sm text-ink-soft">{disclosure.description}</p>
                </div>
              )}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Reproduction steps</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{disclosure.repro_steps}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Target reference</p>
                <p className="mt-1 font-mono text-sm text-ink-soft">{disclosure.target_ref}</p>
              </div>

              {disclosure.reasoning && (
                <div className="rounded-xl bg-ink/[0.03] p-4">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">
                    <Gavel className="h-3.5 w-3.5" /> Validator reasoning
                  </p>
                  <p className="mt-1.5 text-sm text-ink-soft">{disclosure.reasoning}</p>
                  {disclosure.confidence && (
                    <p className="mt-2 text-xs text-ink-faint">
                      Confidence {(parseFloat(disclosure.confidence) * 100).toFixed(0)}%
                    </p>
                  )}
                </div>
              )}

              {disclosure.evidence_snapshot && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                    Live evidence snapshot (fetched at triage, not the researcher&rsquo;s own claim)
                  </p>
                  <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-xl bg-ink/[0.03] p-3 font-mono text-xs text-ink-soft">
                    {disclosure.evidence_snapshot}
                  </p>
                </div>
              )}

              {disclosure.status === "VERIFIED" && (
                <p className="text-xs text-ink-faint">
                  Challenge window {challengeWindowOpen ? "closes" : "closed"} {timeAgo(disclosure.challenge_window_ends_at)}
                  {" "}(a {Math.round(DUPLICATE_CHALLENGE_WINDOW_SECONDS / 3600)}h window from verification).
                </p>
              )}

              {state.phase !== "idle" ? (
                <TransactionPanel state={state} onReset={reset} successLabel="Confirmed on-chain" />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {disclosure.status === "PENDING" && (
                    <Button size="sm" onClick={() => act(() => triage(client!, bountyAddress, disclosure.id), true)} disabled={!client || busy}>
                      <Search className="h-3.5 w-3.5" /> Run triage
                    </Button>
                  )}
                  {challengeWindowOpen && (
                    <Button size="sm" variant="outline" onClick={() => setChallengeOpen(true)}>
                      <ShieldAlert className="h-3.5 w-3.5" /> Challenge as duplicate
                    </Button>
                  )}
                  {canFinalize && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => act(() => finalizePayout(client!, bountyAddress, disclosure.id))}
                      disabled={!client || busy}
                    >
                      <Coins className="h-3.5 w-3.5" /> Finalize payout
                    </Button>
                  )}
                  {disclosure.status === "VERIFIED" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => act(() => resolveDuplicate(client!, bountyAddress, disclosure.id))}
                      disabled={!client || busy}
                      title="Permissionless -- reverts harmlessly if no challenge is currently open on this disclosure."
                    >
                      <Gavel className="h-3.5 w-3.5" /> Resolve open challenge
                    </Button>
                  )}
                  {canClaim && (
                    <Button size="sm" onClick={() => act(() => claimPayout(client!, bountyAddress, disclosure.id), true)} disabled={!client || busy}>
                      <Coins className="h-3.5 w-3.5" /> Claim {formatGen(claimable ?? "0")} GEN
                    </Button>
                  )}
                  {canExpire && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => act(() => expireDisclosure(client!, bountyAddress, disclosure.id), true)}
                      disabled={!client || busy}
                    >
                      <Clock className="h-3.5 w-3.5" /> Expire & refund bond
                    </Button>
                  )}
                  {canExpireUnclaimedPayout && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => act(() => expireUnclaimedPayout(client!, bountyAddress, disclosure.id))}
                      disabled={!client || busy}
                      title="Never moves any GEN -- just unblocks the sponsor's pool withdrawal after 30 days of no claim."
                    >
                      <Clock className="h-3.5 w-3.5" /> Expire unclaimed payout
                    </Button>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ChallengeDuplicateDialog
        open={challengeOpen}
        onOpenChange={setChallengeOpen}
        bountyAddress={bountyAddress}
        disclosureId={disclosure.id}
        onSuccess={onRefresh}
      />
    </div>
  );
}
