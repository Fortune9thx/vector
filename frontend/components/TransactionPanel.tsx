"use client";

import { motion } from "framer-motion";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { ConsensusVisualizer } from "./ConsensusVisualizer";
import { Button } from "./ui/button";
import type { TransactionLifecycleState } from "@/lib/useTransactionLifecycle";
import { studioDevnet as studioDev } from "genlayer-js/chains";

const EXPLORER_BASE = studioDev.blockExplorers?.default?.url ?? "https://explorer-studio-dev.genlayer.com/";

export function TransactionPanel({
  state,
  onReset,
  successLabel = "Confirmed on-chain",
}: {
  state: TransactionLifecycleState;
  onReset?: () => void;
  successLabel?: string;
}) {
  if (state.phase === "idle") return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="paper-card flex flex-col items-center gap-4 p-6"
    >
      {state.phase === "submitting" && (
        <div className="flex flex-col items-center gap-3 py-6 text-ink-soft">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Waiting for wallet signature…</p>
        </div>
      )}

      {state.phase === "polling" && state.status && (
        <ConsensusVisualizer status={state.status} transaction={state.transaction} />
      )}

      {state.phase === "success" && (
        <div className="flex flex-col items-center gap-2 py-4">
          <CheckCircle2 className="h-8 w-8 text-ink" />
          <p className="text-sm font-medium text-ink">{successLabel}</p>
        </div>
      )}

      {state.phase === "error" && (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <XCircle className="h-8 w-8 text-ink" />
          <p className="text-sm font-medium text-ink">{state.error ?? "Something went wrong."}</p>
        </div>
      )}

      {state.hash && (
        <a
          href={`${EXPLORER_BASE}tx/${state.hash}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink"
        >
          {state.hash.slice(0, 10)}…{state.hash.slice(-8)}
        </a>
      )}

      {(state.phase === "success" || state.phase === "error") && onReset && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          Done
        </Button>
      )}
    </motion.div>
  );
}
