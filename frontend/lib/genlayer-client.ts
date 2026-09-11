"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { createClient } from "genlayer-js";
import { studioDevnet as studioDev } from "genlayer-js/chains";
import { TransactionStatus, ExecutionResult } from "genlayer-js/types";
import type {
  GenLayerClient,
  GenLayerChain,
  GenLayerTransaction,
  TransactionHash,
} from "genlayer-js/types";

let _readOnlyClient: GenLayerClient<GenLayerChain> | null = null;

/**
 * A wallet-free client for read-only pages (bounty explorer, bounty detail,
 * dashboard) -- readContract needs no signer, confirmed working across
 * every prior GenLayer frontend on this stack. Never construct this with an
 * account: omitting `account` entirely is what keeps it read-only
 * (createAccount() with no arguments generates a fresh random wallet on
 * every call and triggers wallet permission prompts -- a real, confirmed
 * GenLayer rejection pattern this deliberately avoids).
 */
export function getReadOnlyClient(): GenLayerClient<GenLayerChain> {
  if (!_readOnlyClient) {
    _readOnlyClient = createClient({ chain: studioDev });
  }
  return _readOnlyClient;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * GenLayer's gen_call read path has real, confirmed intermittent failures
 * ("failed to get latest accepted transactions", "contract not found")
 * against genuinely valid, successfully-deployed contracts -- confirmed
 * infra flakiness on this stack (seen on both Bradbury and Studio Devnet),
 * independent of contract logic. A
 * single-attempt read on first page load is fragile against this; wrap any
 * read a write decision depends on (e.g. the creation stake or disclosure
 * bond a payable call's `value` is computed from) in this retry rather than
 * let one transient failure silently propagate into a fabricated fallback
 * value or a stuck "loading" state forever.
 *
 * Each attempt is wrapped in an explicit timeout, not just retried on
 * rejection -- the underlying RPC call can simply never settle under
 * degraded network conditions, which would otherwise make `await fn()` hang
 * indefinitely on the very first attempt.
 */
export async function readContractRetry<T>(
  fn: () => Promise<T>,
  {
    attempts = 5,
    intervalMs = 2000,
    timeoutMs = 8000,
  }: { attempts?: number; intervalMs?: number; timeoutMs?: number } = {}
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await withTimeout(fn(), timeoutMs);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
  }
  throw lastErr;
}

export function useGenLayerClient(): {
  client: GenLayerClient<GenLayerChain> | null;
  address: `0x${string}` | undefined;
} {
  const { address, isConnected, connector } = useAccount();
  const [client, setClient] = useState<GenLayerClient<GenLayerChain> | null>(null);

  // connector.getProvider() returns whichever EIP-1193 provider wagmi
  // actually established the connection through -- matches every connector
  // type (injected, WalletConnect, Coinbase Smart Wallet, Safe), unlike
  // reading window.ethereum directly which only works for a single
  // browser-extension wallet.
  useEffect(() => {
    let cancelled = false;
    if (!isConnected || !address || !connector) {
      setClient(null);
      return;
    }
    connector
      .getProvider()
      .then((provider) => {
        if (cancelled) return;
        setClient(
          createClient({
            chain: studioDev,
            account: address,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            provider: provider as any,
          })
        );
      })
      .catch(() => {
        if (!cancelled) setClient(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isConnected, address, connector]);

  return { client, address };
}

// ---------------------------------------------------------------------
// Consensus polling -- drives the live transaction-lifecycle UI directly
// off real chain state, no fabricated timers. Contract-agnostic: takes only
// a tx hash, so it's shared across VectorFactory and every VectorBounty.
// ---------------------------------------------------------------------

const TERMINAL_STATUSES = new Set<TransactionStatus>([
  TransactionStatus.ACCEPTED,
  TransactionStatus.FINALIZED,
  TransactionStatus.UNDETERMINED,
  TransactionStatus.CANCELED,
  TransactionStatus.VALIDATORS_TIMEOUT,
  TransactionStatus.LEADER_TIMEOUT,
]);

const FINALIZED_REQUIRED_STATUSES = new Set<TransactionStatus>([
  TransactionStatus.FINALIZED,
  TransactionStatus.UNDETERMINED,
  TransactionStatus.CANCELED,
  TransactionStatus.VALIDATORS_TIMEOUT,
  TransactionStatus.LEADER_TIMEOUT,
]);

export interface ConsensusTick {
  status: TransactionStatus;
  transaction: GenLayerTransaction;
}

const MAX_CONSECUTIVE_RPC_FAILURES = 4;

export class PollCancelledError extends Error {
  constructor() {
    super("Polling was cancelled");
    this.name = "PollCancelledError";
  }
}

/**
 * Polls the real transaction status until a terminal state is reached,
 * invoking onTick on every observed status change. isCancelled is checked
 * before every network call and every sleep so an unmounted caller stops
 * the loop from actually running, not just from reporting status. A single
 * transient RPC failure is tolerated up to MAX_CONSECUTIVE_RPC_FAILURES
 * times before giving up, since one bad request doesn't mean the
 * transaction itself failed.
 */
export async function pollConsensusStatus(
  client: GenLayerClient<GenLayerChain>,
  hash: `0x${string}`,
  onTick: (tick: ConsensusTick) => void,
  {
    intervalMs,
    maxAttempts,
    isCancelled = () => false,
    requireFinalized = false,
  }: {
    intervalMs?: number;
    maxAttempts?: number;
    isCancelled?: () => boolean;
    requireFinalized?: boolean;
  } = {}
): Promise<GenLayerTransaction> {
  const terminalStatuses = requireFinalized ? FINALIZED_REQUIRED_STATUSES : TERMINAL_STATUSES;
  const effectiveIntervalMs = intervalMs ?? (requireFinalized ? 5000 : 1500);
  const effectiveMaxAttempts = maxAttempts ?? (requireFinalized ? 100 : 120);
  let lastStatus: TransactionStatus | null = null;
  let consecutiveFailures = 0;

  for (let attempt = 0; attempt < effectiveMaxAttempts; attempt++) {
    if (isCancelled()) throw new PollCancelledError();

    let transaction: GenLayerTransaction;
    try {
      transaction = await client.getTransaction({ hash: hash as TransactionHash });
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures += 1;
      if (consecutiveFailures > MAX_CONSECUTIVE_RPC_FAILURES) throw err;
      await new Promise((resolve) => setTimeout(resolve, effectiveIntervalMs));
      continue;
    }

    const status = transaction.statusName ?? TransactionStatus.PENDING;

    if (status !== lastStatus) {
      onTick({ status, transaction });
      lastStatus = status;
    }

    if (terminalStatuses.has(status)) {
      return transaction;
    }

    if (isCancelled()) throw new PollCancelledError();
    await new Promise((resolve) => setTimeout(resolve, effectiveIntervalMs));
  }

  throw new Error(
    requireFinalized
      ? "Timed out waiting for the transaction to finalize."
      : "Timed out waiting for transaction to reach a terminal status"
  );
}

// ---------------------------------------------------------------------
// Strict success/failure determination.
//
// A terminal consensus status (ACCEPTED/FINALIZED) means the NETWORK agreed
// on an outcome -- it does NOT mean that outcome was a successful
// execution. A contract call that reverts via gl.vm.UserError(...) still
// reaches statusName: ACCEPTED, with txExecutionResultName:
// "FINISHED_WITH_ERROR". Checking statusName alone reports that as success:
// a green checkmark on a transaction that changed nothing.
//
// The only genuinely successful outcome is the explicit allowlisted value
// ExecutionResult.FINISHED_WITH_RETURN. Anything else -- FINISHED_WITH_ERROR,
// the transitional NOT_VOTED value, or txExecutionResultName missing
// entirely (it's an optional field on GenLayerTransaction) -- must be
// treated as "not a confirmed success", never defaulted to success.
// ---------------------------------------------------------------------

const SUCCESS_STATUSES = new Set<TransactionStatus>([TransactionStatus.ACCEPTED, TransactionStatus.FINALIZED]);

export interface TransactionOutcome {
  succeeded: boolean;
  reason: string | null;
}

export function describeTransactionOutcome(transaction: GenLayerTransaction): TransactionOutcome {
  const status = transaction.statusName;
  const result = transaction.txExecutionResultName;

  if (!status || !SUCCESS_STATUSES.has(status)) {
    return { succeeded: false, reason: `Transaction did not reach consensus (status: ${status ?? "unknown"}).` };
  }

  if (result === ExecutionResult.FINISHED_WITH_RETURN) {
    return { succeeded: true, reason: null };
  }

  if (result === ExecutionResult.FINISHED_WITH_ERROR) {
    return {
      succeeded: false,
      reason: "The transaction reached consensus but reverted on-chain -- nothing was changed. Check the contract's error message and try again.",
    };
  }

  return {
    succeeded: false,
    reason: `Transaction reached consensus but its execution result is unconfirmed (${result ?? "missing"}). Not treating this as a success.`,
  };
}
