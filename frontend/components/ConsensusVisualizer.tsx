"use client";

import { motion } from "framer-motion";
import { TransactionStatus } from "genlayer-js/types";
import type { GenLayerTransaction } from "genlayer-js/types";

const STEPS: { status: TransactionStatus; label: string }[] = [
  { status: TransactionStatus.PENDING, label: "Submitted" },
  { status: TransactionStatus.PROPOSING, label: "Proposing" },
  { status: TransactionStatus.ACCEPTED, label: "Accepted" },
  { status: TransactionStatus.FINALIZED, label: "Finalized" },
];

const STEP_ORDER: Record<string, number> = {
  [TransactionStatus.PENDING]: 0,
  [TransactionStatus.PROPOSING]: 1,
  [TransactionStatus.ACCEPTED]: 2,
  [TransactionStatus.FINALIZED]: 3,
};

export function ConsensusVisualizer({
  status,
  transaction,
}: {
  status: TransactionStatus;
  transaction: GenLayerTransaction | null;
}) {
  const activeIdx = STEP_ORDER[status] ?? 0;
  const isTimeoutLike =
    status === TransactionStatus.LEADER_TIMEOUT ||
    status === TransactionStatus.VALIDATORS_TIMEOUT ||
    status === TransactionStatus.UNDETERMINED ||
    status === TransactionStatus.CANCELED;

  return (
    <div className="flex w-full flex-col items-center gap-5 py-4">
      <div className="flex w-full max-w-sm items-center">
        {STEPS.map((step, i) => (
          <div key={step.status} className="flex flex-1 items-center">
            <div className="flex flex-col items-center gap-2">
              <motion.div
                animate={{
                  scale: i === activeIdx && !isTimeoutLike ? [1, 1.15, 1] : 1,
                }}
                transition={{ repeat: i === activeIdx && !isTimeoutLike ? Infinity : 0, duration: 1.4 }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold"
                style={{
                  background: i <= activeIdx && !isTimeoutLike ? "var(--color-yellow)" : "rgba(16,16,9,0.06)",
                  color: "var(--color-ink)",
                }}
              >
                {i + 1}
              </motion.div>
              <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-soft">
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className="mx-1 h-px flex-1"
                style={{ background: i < activeIdx ? "var(--color-yellow)" : "var(--color-border)" }}
              />
            )}
          </div>
        ))}
      </div>
      {isTimeoutLike && (
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
          Status: {status}
        </p>
      )}
      {transaction?.numOfRounds !== undefined && (
        <p className="font-mono text-[0.6875rem] text-ink-faint">round {transaction.numOfRounds}</p>
      )}
    </div>
  );
}
