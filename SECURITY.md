# Security & known limitations

This document discloses platform characteristics and design trade-offs that
are **not contract bugs** but will look like defects if hidden. Two real
bugs were found and fixed here (both below, marked FIXED); everything else
is a genuine platform/toolchain characteristic with no contract-side fix
available.

## [LIVE BLOCKER, unresolved] `create_bounty()` cannot complete on studio-dev

Confirmed live 2026-09-11 against the deployed factory
(`0x47c73afa388b40aAbd04CaB0bBB144bF5E97fAF5`): a real `create_bounty()`
call reached `FINALIZED` but `FINISHED_WITH_ERROR`, with the leader receipt's
actual payload reading `"fee no_matching_allocation # internal"`.
`create_bounty` internally calls `gl.contract.deploy()` to spawn the child
`VectorBounty` -- Consensus v0.6's fee system has no working allocation path
yet for a write that itself triggers an internal deploy/call message.
Independently confirmed a second way: switching to
`client.estimateTransactionFeesForWrite()` (which simulates the actual call)
for this same write fails server-side with a bare `"execution failed"`
before even returning an estimate. Neither documented fee-estimation flow
works for this specific call shape.

This is a platform-level gap, not a Vector contract bug -- it blocks
`create_bounty` identically regardless of any code in this repo, and would
have blocked the prior factory deployment just as much. Practically: **no
one can open a new bounty program on studio-dev right now** through the
standard SDK flow. Not yet resolved; the documented next thing to try is
`gltest --fee-profile` / `genlayer deploy --fee-profile` against a real
`messageAllocations` entry (numeric `messageType: 1` for internal, not the
string `"internal"` the CLI's own `--help` text implies), which past
investigation on this account got past the type error but then hit a
zero-detail `InvalidFeeParams`. Re-check whether this has improved before
assuming it's still broken -- this is exactly the kind of platform state
that can shift day to day (see the runner-hash entry below for a precedent).

## [FIXED] `PAYOUT_PENDING` could permanently block pool withdrawal

`PAYOUT_PENDING` is deliberately excluded from `TERMINAL_DISCLOSURE_STATUSES`
(`VectorBounty.py`), and the only transition out of it was `claim_payout`,
gated to the exact `researcher` address. If that researcher never called it
-- a lost key, a typo'd receiving setup, or a contract address that can never
receive a native transfer -- `withdraw_unused_pool` reverted forever with
"Disclosure {id} is still PAYOUT_PENDING", even after the sponsor closed the
program and every other disclosure resolved.

Fixed with `expire_unclaimed_payout(disclosure_id)`: permissionless, callable
once `PAYOUT_CLAIM_TIMEOUT_SECONDS` (30 days) have passed since
`finalize_payout` (recorded in the new `payout_pending_at` field), moves the
disclosure to `EXPIRED`. It never moves any GEN -- `pool_remaining` is only
ever decremented inside `claim_payout` itself, so an expired-not-claimed
payout simply never happened; this just unblocks `withdraw_unused_pool`. 30
days was chosen because `claim_payout` is a plain deterministic call with no
consensus/nondet obstacle, so a genuine researcher can claim within days; the
window exists only to eventually recover from an abandoned address, not to
pressure a slow one.

## [FIXED] A sponsor could drain third-party pool donations

`fund_pool()` is deliberately permissionless -- "anyone can top up a pool" --
so a bounty's pool can hold real third-party donations, not only the
sponsor's own money. `submit_disclosure()` had no check preventing the
sponsor from being the researcher: a sponsor could privately ensure their own
live target had a real-but-trivial flaw, self-disclose it, have `triage()`
genuinely verify it (no consensus bug involved -- the flaw is real), and
claim a payout out of a pool funded in part by other people.

Fixed with a hard reject in `submit_disclosure`:
`_normalize_address(sender) == _normalize_address(self.sponsor)` now reverts
with "The bounty's own sponsor may not submit a disclosure against it." This
closes the direct form of the exploit; it does not (and cannot, on-chain)
prevent a sponsor from using a second wallet they control.

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
`VectorBounty` -- 56 of 77 tests as of this migration (52 pre-existing, plus
4 covering the two fixes above). This is a toolchain gap, not a contract
bug. `tests/direct/conftest.py`'s `deploy_bounty()` catches this exact
`AttributeError` and calls `pytest.skip()` with a clear reason, so CI
reports these as skipped rather than failed -- the affected paths (bounty
creation, disclosure submission, triage, expiry) are covered by lint and
code inspection, not by a currently-passing direct-mode run, until `gltest`
catches up or an integration-network run is done (`gltest tests/integration
--network studio_devnet`).

A second, unrelated bug was found and fixed in the same investigation:
`conftest.py`'s `_find_real_address_cls()` used a version-agnostic glob
(`**/genlayer/py/types.py`) to locate the SDK's `Address` class, which
matched a *stale pre-v0.3.0* SDK generation's compat path in
`~/.cache/gltest-direct/extracted/` and inserted its `sdk_root` into
`sys.path[0]` -- shadowing the correct module tree for the rest of the
process and breaking the very first contract import of any fresh test
session (`No module named 'genlayer.types'`/`'genlayer.py'`, not the
GetTimestamp `AttributeError`). Fixed by scoping the search to
`extracted/local/` (this pinned hash's own cache) and the current
`genlayer/types/__init__.py` path. This was a test-harness bug, not a
contract or platform issue, but it was masking real signal: two
`test_factory_validation.py` tests were spuriously failing on a cold
`gltest` process before this fix.

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

## [FIXED] CI never actually ran, and would have failed if it had

This repository initially had no git history. Once pushed, all three of the
first CI runs genuinely failed -- verified via `gh run list`/`gh run view`,
not assumed. `pip install`, `genvm-lint`, and the frontend build job all
passed; only `gltest (direct-mode)` failed, on the exact `GetTimestamp` gap
described above. `requirements.txt` was repinned from the pre-migration
stable toolchain to the RC family this contract code actually needs
(`genlayer-py==0.19.0rc2`, `genlayer-test==0.30.0rc2`,
`genvm-linter==0.11.1rc2`), and the `deploy_bounty()`/`_find_real_address_cls()`
fixes above turn the previously-hard-failing test job into a clean
pass/skip split with zero failures. `ci.yml`'s `GENVM_SDK_VERSION: v0.2.16`
tarball-caching step was left as-is: it still succeeds as a step (the file
downloads fine), but genvm-lint/gltest actually resolve the SDK through
their own `genvm-manager` cache mechanism regardless of it, so it's
currently inert rather than broken -- worth removing in a later cleanup
pass, not a blocker.

## No SSRF/self-dealing surface left undisclosed

`target_url` is validated against localhost/private/loopback/link-local/
reserved/multicast IP ranges, numeric-encoded IPv4 hosts, explicit ports, and
embedded credentials (`_is_safe_target_url`, both contracts). Sponsor
self-dealing against third-party pool donations is blocked (see above); a
sponsor using a *second* wallet they control to route around that check is
not detectable on-chain and is an accepted residual risk, same as any
address-based access control on any blockchain.
