"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TransactionPanel } from "@/components/TransactionPanel";
import { useTransactionLifecycle } from "@/lib/useTransactionLifecycle";
import { useGenLayerClient } from "@/lib/genlayer-client";
import { submitDisclosure } from "@/lib/vector-calls";
import { formatGen } from "@/lib/utils";
import { SEVERITY_LEVELS, type SeverityLevel } from "@/lib/vector-abi";

export function SubmitDisclosureDialog({
  open,
  onOpenChange,
  bountyAddress,
  bondWei,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bountyAddress: `0x${string}`;
  bondWei: string;
  onSuccess?: () => void;
}) {
  const { client } = useGenLayerClient();
  const { state, run, reset } = useTransactionLifecycle(client);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reproSteps, setReproSteps] = useState("");
  const [targetRef, setTargetRef] = useState("");
  const [severity, setSeverity] = useState<SeverityLevel>("medium");
  const [validationError, setValidationError] = useState<string | null>(null);

  const busy = state.phase === "submitting" || state.phase === "polling";

  const handleSubmit = () => {
    setValidationError(null);
    if (!title.trim()) return setValidationError("Give this disclosure a title.");
    if (!reproSteps.trim()) return setValidationError("Reproduction steps are required.");
    if (!targetRef.trim())
      return setValidationError("Point to the exact file/function/endpoint the live target should show.");

    run(() =>
      submitDisclosure(
        client!,
        bountyAddress,
        title.trim(),
        description.trim(),
        reproSteps.trim(),
        targetRef.trim(),
        severity,
        BigInt(bondWei)
      )
    ).then(() => {
      if (onSuccess) onSuccess();
    });
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      reset();
      setTitle("");
      setDescription("");
      setReproSteps("");
      setTargetRef("");
      setSeverity("medium");
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Submit a disclosure</DialogTitle>
          <DialogDescription>
            Bonded at {formatGen(bondWei)} GEN. Refunded on any genuine, verified, or
            unverifiable outcome — forfeited to the pool only if triage finds this disclosure
            not real.
          </DialogDescription>
        </DialogHeader>

        {state.phase === "idle" ? (
          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-soft">Title</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Reflected XSS in /search" maxLength={140} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-soft">Description</label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is the vulnerability and what is its real-world impact?"
                maxLength={2000}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-soft">Reproduction steps</label>
              <Textarea
                value={reproSteps}
                onChange={(e) => setReproSteps(e.target.value)}
                placeholder="Exact steps a validator can follow against the live target."
                maxLength={3000}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-soft">Target reference</label>
              <Input
                value={targetRef}
                onChange={(e) => setTargetRef(e.target.value)}
                placeholder="/api/search?q=, the login form, etc."
                maxLength={300}
              />
              <p className="mt-1 text-xs text-ink-faint">
                The specific file, function, endpoint, or element validators should check for.
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-soft">Claimed severity</label>
              <div className="flex flex-wrap gap-2">
                {SEVERITY_LEVELS.map((level) => (
                  <button
                    key={level}
                    onClick={() => setSeverity(level)}
                    className={
                      severity === level
                        ? "meta-pill bg-ink text-paper normal-case tracking-normal"
                        : "meta-pill hover:bg-ink/10 normal-case tracking-normal"
                    }
                  >
                    {level.charAt(0).toUpperCase() + level.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            {validationError && <p className="text-xs text-ink">{validationError}</p>}
            <Button onClick={handleSubmit} disabled={!client || busy}>
              {client ? `Submit & bond ${formatGen(bondWei)} GEN` : "Connect a wallet to continue"}
            </Button>
          </div>
        ) : (
          <TransactionPanel state={state} onReset={() => handleOpenChange(false)} successLabel="Disclosure submitted" />
        )}
      </DialogContent>
    </Dialog>
  );
}
