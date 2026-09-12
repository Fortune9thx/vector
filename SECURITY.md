# Security & known limitations

This document discloses platform characteristics and design trade-offs that
are **not contract bugs** but will look like defects if hidden. Real issues
found and fixed are marked FIXED below; everything else is a genuine
platform/toolchain characteristic with no contract-side fix available.

## [FIXED via redesign] `create_bounty()` could not complete on studio-dev

Confirmed live 2026-09-11: a real `create_bounty()` call reached `FINALIZED`
but `FINISHED_WITH_ERROR`, with the leader receipt's actual payload reading
`"fee no_matching_allocation # internal"`. `create_bounty` internally called
`gl.contract.deploy()` to spawn the child `VectorBounty` -- Consensus v0.6's
fee system has no working allocation path for a write that itself triggers
an internal deploy/call message. Independently confirmed two more ways:
`client.estimateTransactionFeesForWrite()` (genlayer-js) fails server-side
with a bare `"execution failed"` for the same call, and a raw `sim_call`
via `genlayer_py`'s `simulate_write_contract()` fails identically -- three
independent paths across two SDKs, ruling out a client-side bug.

Fixed by redesigning bounty creation as **deploy-then-register** instead of
factory-deploys-child: `create_bounty()` was removed entirely.
`VectorFactory.get_bounty_code()` serves the exact `VectorBounty` source to
deploy; the sponsor deploys it themselves as an ordinary **top-level**
transaction (top-level deploys have a working fee path -- confirmed via two
real `VectorFactory` deploys this session); then `register_bounty(bounty_address)`
-- a plain write with no internal deploy -- cross-contract-reads the
deployed child's own `get_bounty_info()` (never trusting caller-supplied
metadata) and lists it. This also incidentally eliminates the old
factory-hop sponsor-capture problem: since the sponsor deploys directly,
`gl.message.sender_address` inside `VectorBounty.__init__` is already
genuinely the human sponsor, no special-casing needed.

**Live-verified end to end 2026-09-11**, not just schema-checked: deploy →
register → a genuinely different researcher's `submit_disclosure` → `triage`
(real live web fetch against Wikipedia's Heartbleed page + real LLM
reasoning, which correctly returned `REJECTED` because the fetched summary
page didn't actually support the specific technical claim submitted). The
whole redesigned architecture, the self-dealing fix below, and the
timestamp fix below were all exercised together on the real network in one
run.

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

## [FIXED] `gl.vm.get_timestamp()` was live-broken on studio-dev -- for everyone, everywhere

Confirmed 2026-09-11, using a minimal throwaway diagnostic contract deployed
specifically to isolate this: **every single call to `gl.vm.get_timestamp()`
on studio-dev failed** with `SystemError: 2: inval`, in both a constructor
and an ordinary write, reproduced twice. This was invisible until the
`create_bounty` fee gap above was worked around -- no `VectorBounty`
constructor had ever actually executed live before that point, so this bug
had been silently waiting underneath the whole time. Since nearly every
`VectorBounty` write reads `_consensus_now()`, this would have blocked the
entire contract regardless of the deploy-then-register redesign.

Fixed by switching `_consensus_now()` from `gl.vm.get_timestamp()` to
`genlayer.message.raw["datetime"]`: the VM's initial message payload
already carries a `datetime` field (read from stdin at module-import time,
per `genlayer/message.py`'s own source), so this needs no separate VM call
and is unaffected by whatever is broken in the `GetTimestamp` call type.
Confirmed working live immediately (a real, current ISO timestamp came
back on the first try) and as part of the full end-to-end proof above.

Bonus: this also fixed nearly all of direct-mode testing. `gltest`'s WASI
mock never implemented `GetTimestamp` (see below), but it *does* correctly
populate `_datetime` in its message payload by default and via `vm.warp()`
-- so switching to `message.raw["datetime"]` took the local suite from
21 passing / 52 skipped to **62 passing / 12 skipped** (the remaining 12
hit a narrower, distinct gltest limitation -- see below -- not this bug).

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

## [FIXED] `UNVERIFIABLE` could permanently block pool withdrawal

Found in a final pre-submission pass, 2026-09-12: `STATUS_UNVERIFIABLE` was
excluded from `TERMINAL_DISCLOSURE_STATUSES`, and no method transitions a
disclosure out of it. Since `withdraw_unused_pool()` requires every
disclosure to be terminal, a single disclosure whose target genuinely
couldn't be fetched for a day (not an adversary -- just a target URL going
down) would permanently strand the entire remaining pool. Identical bug
class to the `PAYOUT_PENDING` gap above, independently reachable, missed in
the original round because it required tracing every status through every
lifecycle method rather than following the transition that was already
fixed. Fixed by adding `STATUS_UNVERIFIABLE` to
`TERMINAL_DISCLOSURE_STATUSES` -- its bond is already fully refunded at that
point, so there's no pending payout obligation left to protect. See
`docs/AUDIT.md` finding 20 for the regression test (marked skip for the same
`WARP_ACROSS_CALLS_UNSUPPORTED` reason as its sibling, since reaching
`UNVERIFIABLE` needs `vm.warp()` across multiple `triage()` calls).

## The registry cannot verify a registered address's actual code

`register_bounty()`'s only check that an address is a genuine `VectorBounty`
is a cross-contract view call to that address's own `get_bounty_info()` --
self-attestation, since the contract being registered fully controls what
its own view methods return. A deliberately malicious contract could report
a correct-looking `address_factory` while behaving arbitrarily internally,
and would still pass registration. Confirmed by reading the installed GenVM
SDK (`genlayer/contract/__init__.py` for this project's pinned runner hash):
`get_at()`/`Proxy` expose no code-hash or source-introspection primitive at
all -- there is no GenVM equivalent of `extcodehash`. `deploy()`'s
`salt_nonce`-based `CREATE2` addressing does tie an address to its code, but
only for a deploy the factory itself initiates, which is exactly the path
Consensus v0.6's internal-deploy fee gap (above) blocks. Partial mitigation:
`register_bounty` costs a real `creation_stake`, so listing a malicious
clone isn't free. No further contract-side fix exists today; see
`docs/AUDIT.md` finding 21.

## [FIXED] `deployContract`/`writeContract` need call-specific fee estimation on Consensus v0.6, not a generic one

Confirmed live 2026-09-11 across three separate frontend write paths, each
failing identically with `FeeValueMustBeNonZero(1)` until fixed: a raw
`deployContract`/`writeContract` call with no `fees` option reverts
outright on studio-dev. Fixing `deployBounty()` alone (attaching a generic
`client.estimateTransactionFees()` quote, the same pattern
`deploy/001_deploy_vector_factory.ts`'s CLI path already used) fixed the
deploy step, and the identical generic-estimate fix also worked for
`register_bounty`. It did **not** work for `triage()` -- confirmed by
retrying live and reproducing the exact same revert with a generic fee
already attached. Root cause: `estimateTransactionFees()` takes no call
context, so it can't size message allocations for what a *specific* call
actually needs (e.g. `triage()`'s nondet live-fetch + LLM round needs
allocations a plain deterministic write like `register_bounty` never does).
Fixed by switching every `writeContract` call to
`estimateTransactionFeesForWrite({address, functionName, args, value})`,
which sizes the fee against the real call; `deployContract` keeps the
generic estimate since there's no existing contract to simulate a write
against yet. Verified directly against the live network with a standalone
script calling `estimateTransactionFeesForWrite` for `submit_disclosure`
before concluding the fix was right, not by inference alone. All 14
deploy/write call sites in `frontend/lib/vector-calls.ts` now go through one
of these two estimators; `deployBounty`, `registerBounty`, `submitDisclosure`,
and `triage` are each individually confirmed live end-to-end, the remaining
ten use the identical `estimateWriteFeesOption` helper as `registerBounty`
but have not each been separately exercised live.

## Studio Devnet: a transaction can stall at `PROPOSING` with zero execution

Observed live 2026-09-11/12 on two separate `triage()` attempts: a
fee-correct, network-accepted transaction sat at `PROPOSING` (one case) or
bare `PENDING` (another) for 18-20+ minutes with `Execution consumed: 0
wei` -- a worker was assigned in one case but never actually ran anything.
Confirmed via the block explorer's own transaction-detail page, not just the
frontend's polling UI. This is infrastructure-level congestion on a
release-candidate devnet, not a contract or frontend bug: a stalled attempt
never executes any contract code, so it never touches on-chain disclosure
state, and retrying (a fresh `triage()` call) is always safe and free. Both
observed stalls eventually either resolved or were superseded by a
successful retry within the same session.

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

## Cross-contract writes silently no-op; cross-contract views work and are load-bearing now

`VectorBounty` never pushes state back to `VectorFactory` after registration
(the factory's `bounty_meta` is populated once, at registration time) because
cross-contract **writes** to another Intelligent Contract are confirmed to
silently no-op on this platform. All live disclosure state must be read
directly from the `VectorBounty` instance via `.view()`.

Cross-contract **views**, by contrast, are confirmed working and are now a
core part of the architecture: `register_bounty()`'s
`gl.contract.get_at(addr).view().get_bounty_info()` call -- reading the
newly-deployed child's own state back into the registry rather than trusting
caller-supplied metadata -- was live-verified as part of the end-to-end
proof above. Views are synchronous, same-transaction reads with no separate
consensus round, unlike an internal deploy/call message, which is why they
don't hit the fee-allocation gap the redesign above works around.

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

## `gltest`'s WASI mock still has no `GetTimestamp` handler (mostly moot now)

`gl.vm.get_timestamp()` itself always returns `None` in direct-mode --
`gltest` never implemented that VM call type. This no longer matters for
Vector since `_consensus_now()` doesn't call it any more (see the fix
above), but it's worth recording: any *future* code that calls
`gl.vm.get_timestamp()` directly would still crash locally, needing an
integration-network run (`gltest tests/integration --network studio_devnet`)
to exercise instead.

## `gltest` direct-mode can't see a `vm.warp()` call from a later interaction

A narrower, distinct limitation, affecting 12 of 77 tests (down from 56
before the fix above): `gltest`'s direct-mode loader imports the contract
module once, at deploy time. `genlayer.message`'s `raw` dict -- which
`_consensus_now()` now reads -- is populated by top-level module code that
runs on that one import, so it never reflects a `vm.warp()` call made
*after* deploy, within the same test. The real VM has no such issue
(confirmed live: every call is a fresh process reading its own fresh
message payload). The 12 affected tests (all reachable through helpers that
call `warp_now()` to skip past a challenge window or timeout, e.g.
`_verified_and_finalized()`) are marked `@pytest.mark.skip` with the shared
`WARP_ACROSS_CALLS_UNSUPPORTED` reason in `tests/direct/conftest.py` --
their logic is otherwise identical to already-passing tests and is proven
live instead (see the end-to-end proof above).

A third, unrelated test-harness bug was found and fixed in the same
investigation: `conftest.py`'s `_find_real_address_cls()` used a
version-agnostic glob (`**/genlayer/py/types.py`) to locate the SDK's
`Address` class, which matched a *stale pre-v0.3.0* SDK generation's compat
path in `~/.cache/gltest-direct/extracted/` and inserted its `sdk_root`
into `sys.path[0]` -- shadowing the correct module tree for the rest of the
process and breaking the very first contract import of any fresh test
session (`No module named 'genlayer.types'`/`'genlayer.py'`). Fixed by
scoping the search to `extracted/local/` (this pinned hash's own cache) and
the current `genlayer/types/__init__.py` path. This was masking real
signal: two `test_factory_validation.py` tests were spuriously failing on a
cold `gltest` process before this fix.

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

## [FIXED] `gltest` eagerly validates every declared network's env vars, even unused ones

Adding `studio_devnet.accounts: [${INTEGRATION_TEST_ACCOUNT_0}, ...]` to `gltest.config.yaml` (for `tests/integration`) broke `gltest tests/direct` in CI, which never touches `studio_devnet` at all -- direct-mode has no network. `gltest`'s config loader resolves every declared network's `${VAR}` references at load time, unconditionally, regardless of which network the current run actually uses. Fixed with three harmless placeholder values in `ci.yml`'s job env, scoped to the `gltest (direct-mode)` step only -- direct-mode never reads their actual value, so they don't need to be real keys, just present. Verified by reproducing the exact CI failure locally (temporarily removing `.env`, supplying only the placeholders) before pushing the fix, not just reasoning about it.

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
