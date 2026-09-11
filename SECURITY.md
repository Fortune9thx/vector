# Security & known limitations

This document discloses platform characteristics and design trade-offs that
are **not contract bugs** but will look like defects if hidden. It also
tracks the one confirmed liveness gap that is a real bug, pending a design
decision on the correct fix.

## Confirmed liveness gap (must-fix, not yet fixed)

**A disclosure stuck at `PAYOUT_PENDING` permanently blocks pool withdrawal,
with no escape hatch.** `PAYOUT_PENDING` is deliberately excluded from
`TERMINAL_DISCLOSURE_STATUSES` (`VectorBounty.py`), and the only transition
out of it is `claim_payout`, gated to the exact `researcher` address recorded
at `submit_disclosure` time. If that researcher never calls it -- a lost key,
a typo'd receiving setup, or (see below) a contract address that can never
receive a native transfer -- `withdraw_unused_pool` reverts forever with
"Disclosure {id} is still PAYOUT_PENDING", even after the sponsor closes the
program and every other disclosure resolves. This blocks the sponsor's
remaining pool funds indefinitely, with no adversary required.

Not fixed yet because the correct design is a product decision, not a pure
bug fix: a bounded claim-timeout that forfeits an unclaimed payout back to
the pool trades away a legitimately-earned researcher payout for sponsor
liveness, and needs an explicit choice of window and forfeiture-vs-retry
semantics before it's implemented.

## `gl.message.sender_address` is not guaranteed to be a human wallet

GenVM has no on-chain EOA-vs-contract check. `submit_disclosure` records
`gl.message.sender_address.as_hex` as the disclosure's `researcher` field
without verifying it is a human-controlled wallet. If a disclosure is ever
submitted via a cross-contract `.emit()` call (rather than a direct signed
transaction), `researcher` silently becomes the calling contract's address,
and any later payout/bond-refund `emit_transfer()` to it will fail with no
rescue path (see below). Submit disclosures via a direct signed transaction
only.

## Native-value transfers to another Intelligent Contract silently fail

`_Recipient(...).emit_transfer()` (used for bond refunds and payouts)
resolves to a real human EOA in the normal flow, but GenVM has no rescue path
if the recorded address turns out to be a contract rather than a wallet --
the transfer silently fails with no error surfaced back to the caller. This
compounds the liveness gap above: a contract-address "researcher" can never
successfully `claim_payout` even if it tries.

## EOA-directed value transfers only actually execute at FINALIZED, not ACCEPTED

Confirmed platform behavior on this account's other GenLayer builds: a
factory's recorded balance did not decrease when a value-transferring write
reached `ACCEPTED`/`READY_TO_FINALIZE` -- only once it reached true
`FINALIZED`. The frontend's `claimPayout`, `expireDisclosure`, `triage`
(which can trigger a bond refund internally), and `withdrawUnusedPool` all
poll to `FINALIZED` before reporting success for this reason
(`useTransactionLifecycle`'s `requireFinalized` option). Any future write
path that moves value must do the same -- do not report a transfer complete
on `ACCEPTED` alone.

## Cross-contract writes between Vector's own contracts silently no-op

`VectorBounty` never pushes state back to `VectorFactory` after deployment
(the factory's `bounty_meta` is creation-time metadata only) because
cross-contract **writes** to another Intelligent Contract are confirmed to
silently no-op on this platform. All live disclosure state must be read
directly from the `VectorBounty` instance via `.view()`.

## Runner-hash registry instability on Studio Devnet

Both contracts are pinned to `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng`,
confirmed live (via `gen_getContractSchemaForCode`) to be the one hash in
this family that currently resolves. Other hashes -- including the one
GenLayer's own official `v2-dev` examples pin -- fail with
`invalid_contract runner malformed`/`runner absent`, tracked upstream at
[genlayerlabs/genlayer-studio#1757](https://github.com/genlayerlabs/genlayer-studio/issues/1757),
unresolved as of 2026-09-11. Re-probe with a fresh no-gas
`getContractSchemaForCode` call before assuming either hash's status has
changed.

## `gltest` direct-mode cannot exercise any timestamp-touching path

`gltest`'s WASI mock does not implement `GetTimestamp` yet. `gl.vm.get_timestamp()`
(used by `_consensus_now()`, including inside `VectorBounty.__init__`)
returns `None` locally, which crashes every direct-mode test that deploys a
`VectorBounty` -- 52 of 73 tests as of this migration. This is a toolchain
gap, not a contract bug: the affected paths (bounty creation, disclosure
submission, triage, expiry) are covered by lint and code inspection, not by
a currently-passing direct-mode run, until `gltest` catches up or an
integration-network run is done (`gltest tests/integration --network
studio_devnet`).

## `genvm-lint` does not recognize `gl.vm.run_nondet_default`

`triage()` and `resolve_duplicate()` use `gl.vm.run_nondet(leader_fn,
validator_fn)`, where `validator_fn` independently re-fetches the target and
re-runs the LLM before comparing structured fields in plain Python.
Reading the exact installed SDK source for our pinned hash
(`genlayer/vm/__init__.py`), `run_nondet`'s own docstring warns it "does not
use extra sandbox for catching validator errors" and recommends
`run_nondet_default` instead -- whose own canonical docstring example is
close to this exact leader/validator shape (leader fetches external data,
validator re-fetches and compares). Switching to `run_nondet_default` was
tested and confirmed to fail `genvm-lint check` outright (`gl.nondet.* call
... not reachable from equivalence principle block`) on the current
`genvm-linter==0.11.1rc2` -- the linter's static reachability analysis has
not caught up to this part of its own SDK's recommended API surface. Vector
therefore deliberately stays on `run_nondet` (lint-clean, matches this SDK's
own `run_nondet` docstring example almost verbatim) rather than adopt a
primitive the mandatory CI lint gate currently rejects. This is a real,
disclosed platform-tooling limitation, not an oversight -- revisit once
`genvm-lint` recognizes `run_nondet_default`.

## CI has never actually run

This repository has no git history yet (`git init` not yet run), so
`.github/workflows/ci.yml` has never executed once -- its presence is not
evidence of a passing pipeline. Separately, `requirements.txt` currently
pins the pre-migration stable toolchain (`genlayer-py==0.16.3`,
`genlayer-test==0.29.2`, `genvm-linter==0.11.0`), while this machine's
actual installed versions are the Consensus v0.6 RC family
(`genlayer-py==0.19.0rc2`, `genlayer-test==0.30.0rc2`,
`genvm-linter==0.11.1rc2`) that the current v0.3.0 contract code actually
requires. If CI ran today as configured, it would very likely fail --
`requirements.txt` needs to be repinned to the RC versions (and
`ci.yml`'s `GENVM_SDK_VERSION: v0.2.16` / genvm-universal tarball step,
which was chosen specifically for the old pre-migration runner hash,
needs re-deriving for the current hash) before a real green run is possible.

## No SSRF/self-dealing surface left undisclosed

`target_url` is validated against localhost/private/loopback/link-local/
reserved/multicast IP ranges, numeric-encoded IPv4 hosts, explicit ports, and
embedded credentials (`_is_safe_target_url`, both contracts). A sponsor
submitting a disclosure against their own bounty is not prevented -- unlike
an escrow between two adversarial counterparties, Vector's pool is
sponsor-funded, so a sponsor "self-dealing" only moves their own money
against their own real, validator-fetched target; it is not a third-party
fund-safety issue and is left unrestricted by design.
