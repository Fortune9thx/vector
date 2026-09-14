"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TransactionPanel } from "@/components/TransactionPanel";
import { useTransactionLifecycle } from "@/lib/useTransactionLifecycle";
import { useGenLayerClient } from "@/lib/genlayer-client";
import { challengeDuplicate } from "@/lib/vector-calls";
import { formatGen } from "@/lib/utils";

export function ChallengeDuplicateDialog({
  open,
  onOpenChange,
  bountyAddress,
  disclosureId,
  bondWei,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bountyAddress: `0x${string}`;
  disclosureId: string;
  bondWei: string;
  onSuccess?: () => void;
}) {
  const { client } = useGenLayerClient();
  const { state, run, reset } = useTransactionLifecycle(client);
  const [priorId, setPriorId] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const busy = state.phase === "submitting" || state.phase === "polling";

  const handleSubmit = () => {
    setValidationError(null);
    if (!priorId.trim() || !/^\d+$/.test(priorId.trim())) {
      setValidationError("Enter the numeric id of the earlier, already-verified disclosure.");
      return;
    }
    run(() => challengeDuplicate(client!, bountyAddress, disclosureId, priorId.trim(), BigInt(bondWei))).then(() => {
      if (onSuccess) onSuccess();
    });
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      reset();
      setPriorId("");
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Challenge as duplicate</DialogTitle>
          <DialogDescription>
            Claim disclosure #{disclosureId} describes the same underlying vulnerability as an
            earlier, already-verified one. Validators independently compare both disclosures&rsquo;
            own stored evidence before ruling. Opening this stakes {formatGen(bondWei)} GEN &mdash;
            refunded if the challenge is upheld, forfeited to the pool if it isn&rsquo;t.
          </DialogDescription>
        </DialogHeader>

        {state.phase === "idle" ? (
          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-soft">Prior disclosure id</label>
              <Input value={priorId} onChange={(e) => setPriorId(e.target.value)} placeholder="e.g. 3" inputMode="numeric" />
              {validationError && <p className="mt-1.5 text-xs text-ink">{validationError}</p>}
            </div>
            <Button onClick={handleSubmit} disabled={!client || busy}>
              {client ? "Open challenge" : "Connect a wallet to continue"}
            </Button>
          </div>
        ) : (
          <TransactionPanel state={state} onReset={() => handleOpenChange(false)} successLabel="Challenge opened" />
        )}
      </DialogContent>
    </Dialog>
  );
}
