# Resolution Logic

The full disclosure state machine, and exactly what makes each transition trustless rather than assumed.

## States

```
PENDING ──────► TRIAGING ──┬──► REJECTED         (bond forfeited to pool)
   ▲                        ├──► VERIFIED ──► PAYOUT_PENDING ──► PAID
   │                        │        │
   │ (retriable,            │        └──► DUPLICATE            (if challenged and ruled SAME)
   │  no evidence yet)      │
   │                        └──► UNVERIFIABLE   (bond refunded — fetch never succeeded)
   │
   └──────────────────────────► EXPIRED          (bond refunded — escape hatch, any pending/triaging state)
```

`PAID`, `REJECTED`, `DUPLICATE`, and `EXPIRED` are the four terminal states.

## Triage: the trustless part

`triage(disclosure_id)` is callable by anyone, on any `PENDING` disclosure, any number of times. It contains exactly one non-deterministic call: `gl.vm.run_nondet(leader_fn, validator_fn)`.

**`leader_fn`** does two things, in order:

1. Fetches the bounty's `target_url` live, right now, via `gl.nondet.web.render()`.
2. If the fetch came back empty, returns `DECISION_NO_EVIDENCE` immediately — no LLM call at all.
3. Otherwise, slices the real fetched content into `evidence_snapshot` (this is what gets stored on-chain — the actual retrieved bytes, not anything the model claims to have seen), and asks the LLM to independently verify the disclosure against that live evidence: is the claim genuine, how severe is it really, and how confident is the model in that verdict.

**`validator_fn`** calls `leader_fn()` again — a full independent re-fetch of the live target and a full independent LLM call — and only returns `True` if its own independently-derived result agrees with the leader's on every substantive field (`is_real`, `severity`, and confidence within a `0.15` tolerance). It never inspects the leader's output for shape or plausibility alone. This is the entire trust model: a decision only lands once multiple validators, each doing the real work themselves, land on the same answer.

## Fail-closed evidence handling

If the live target is unreachable, every validator's own fetch also comes back empty, and they all agree on `DECISION_NO_EVIDENCE` — genuine agreement requiring zero model consensus, since there's nothing to disagree about. The disclosure falls into one of two outcomes:

- **Retriable** (the common case): fewer than 3 fetch attempts, or less than 24 hours since submission — the disclosure reverts to `PENDING` so anyone can call `triage()` again later once the target may be reachable.
- **`UNVERIFIABLE`**: 3+ fetch attempts *and* 24+ hours have both elapsed. The bond is refunded — an unreachable target is not the researcher's fault.

Both conditions (attempt count *and* elapsed time) are required together, deliberately — a target that's briefly down shouldn't immediately dead-end a genuine disclosure, but a target that's been down for a full day after multiple attempts shouldn't hold a bond hostage indefinitely either.

## Confidence threshold

A verdict only reaches `VERIFIED` if `is_real` is true, the reported severity is one of the four real levels (never `"none"`), **and** confidence clears `0.5`. Below that bar, the disclosure is `REJECTED` and its bond is forfeited to the pool — a genuine economic disincentive for spam or bad-faith submissions, which is what ultimately co-funds honest researchers' payouts alongside the sponsor's own funding.

## Duplicate challenge: the critical invariant

Once `VERIFIED`, a disclosure enters a 48-hour challenge window. Anyone can call `challenge_duplicate(disclosure_id, prior_disclosure_id)` to claim it's the same underlying vulnerability as an earlier, already-verified disclosure. `resolve_duplicate()` then runs a second independent LLM comparison (again validated by independent re-derivation, not shape-checking) between the two disclosures' own stored evidence and reasoning from their respective triage rounds.

**The invariant this design must never violate: a single favorable/DISTINCT verdict against ONE prior disclosure can never confirm global uniqueness.** A `DIFFERENT` ruling only settles *that specific* comparison — the disclosure remains `VERIFIED` and can still be challenged again later against a different `prior_disclosure_id`, or proceed to `finalize_payout` once its window elapses with nothing currently open. This is directly tested: `test_different_verdict_against_one_prior_does_not_block_challenge_against_another` in `tests/direct/test_duplicate_challenge.py` proves a disclosure ruled `DIFFERENT` from one prior finding is still challengeable against a second, separate prior finding.

If a challenge is ruled `SAME`, the disclosure moves to the terminal `DUPLICATE` state — its bond was already refunded at verification time (bond disposition is decided once, at triage, and never revisited), so no further fund movement happens here.

## Payout: two steps, deliberately

`finalize_payout()` is permissionless but moves no money — it only checks the challenge window has elapsed and nothing is currently open, then flips status to `PAYOUT_PENDING`. `claim_payout()` is the one actual transfer, and only the disclosure's own researcher can call it. Splitting these means the permissionless step can never *force* a transfer on anyone's behalf — a deliberate pull-based design choice, not an oversight.

## The escape hatch

`expire_disclosure()` is permissionless, callable on any disclosure still `PENDING` or `TRIAGING` once 7 days have passed since submission. It **always refunds the bond in full, and never forfeits it** — this path exists purely so that if triage can never reach validator agreement no matter how many times it's retried (a genuinely possible outcome under GenLayer's Equivalence Principle), a researcher's bond is never stuck forever. "Permissionlessly retriable" is not the same guarantee as "guaranteed to eventually converge," and this is the bounded liveness backstop for that gap.
