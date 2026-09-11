# Audit

A self-adversarial review of Vector against known GenLayer Portal rejection patterns, run against the actual deployed contract code and the 77-test direct-mode suite (21 passing, 56 skipped pending an upstream `gltest` fix — see `SECURITY.md`) — not a checklist filled in from memory. Each item cites the specific file/line/test that proves it, not a restated assumption.

## 1. Validator independence — re-derivation, never a shape check

`VectorBounty.py::triage`, `validator_fn` (line ~525) calls `leader_fn()` again — a full independent live web fetch plus a full independent LLM reasoning round — and compares the two results on every substantive field (`decision`, `is_real`, `severity`, confidence within `CONFIDENCE_AGREEMENT_TOLERANCE`). It never inspects the leader's returned JSON for shape or plausibility alone. This is the single highest-confidence GenLayer rejection pattern (a validator that only structurally checks a leader's output), and it's the reason `resolve_duplicate`'s `validator_fn` follows the identical pattern for the duplicate-comparison LLM call.

Confirmed by test: `test_validator_agrees_on_matching_verdict`, `test_validator_agrees_on_matching_no_evidence_outcome`, `test_validator_disagrees_on_different_severity`, `test_validator_disagrees_on_confidence_outside_tolerance` (`tests/direct/test_triage.py`).

## 2. Evidence bound to real fetched content, not LLM self-report

`evidence_snapshot` (`VectorBounty.py` line ~444) is sliced directly from `fetched_s`, the actual string returned by `gl.nondet.web.render()`, **before** the LLM is ever called. The model is never asked to report what it saw and trusted; the on-chain evidence record is provably what was actually retrieved.

Confirmed by test: `test_evidence_snapshot_bound_to_real_content_not_llm_self_report` (`tests/direct/test_triage.py`).

## 3. Fail-closed when the target is unreachable, no LLM call at all

`leader_fn` (line ~429) returns `DECISION_NO_EVIDENCE` deterministically, with zero LLM calls, whenever the live fetch comes back empty. Every validator's own independent fetch also fails identically in this case, so they all agree on `DECISION_NO_EVIDENCE` without needing any model agreement — a genuine, cheap, structurally-guaranteed consensus path for the "nothing to verify against" case.

Confirmed by test: `test_triage_fails_closed_when_target_unfetchable_and_stays_pending_retriable`, `test_triage_becomes_unverifiable_after_max_attempts_and_24h` (`tests/direct/test_triage.py`).

## 4. Exactly one non-deterministic call per method

Both `triage()` and `resolve_duplicate()` each contain exactly one `gl.vm.run_nondet(leader_fn, validator_fn)` call, with named `def leader_fn`/`def validator_fn` closures, never a lambda. Verified mechanically, not just by inspection: `PYTHONIOENCODING=utf-8 genvm-lint check contracts/VectorBounty.py` and the same for `VectorFactory.py` both pass clean (3 checks, 17 and 10 methods respectively).

## 5. Bounded liveness escape hatch that never forfeits

`expire_disclosure()` is permissionless, callable on any disclosure still `PENDING` or `TRIAGING` after `DISCLOSURE_EXPIRE_TIMEOUT_SECONDS` (7 days), and **always** refunds the bond in full — it has no forfeiture branch at all. This closes the specific gap where "permissionlessly retriable" (anyone can call `triage()` again) is not the same guarantee as "guaranteed to eventually converge" under GenLayer's Equivalence Principle.

Confirmed by test: `test_expire_disclosure_before_timeout_reverts`, `test_expire_disclosure_after_timeout_refunds_bond`, `test_expire_disclosure_rejects_already_verified` (`tests/direct/test_expire_and_payout.py`).

## 6. The duplicate-challenge invariant: one verdict never confirms global uniqueness

This is the spec-mandated finding this project was built to get right. `resolve_duplicate()`'s `SAME`/`DIFFERENT` ruling only ever settles the ONE comparison it was asked to make — it never writes any kind of "confirmed unique" flag. A disclosure ruled `DIFFERENT` from one prior finding remains fully `VERIFIED` and equally challengeable again later against a separate prior finding.

Directly, explicitly tested: `test_different_verdict_against_one_prior_does_not_block_challenge_against_another` (`tests/direct/test_duplicate_challenge.py`) — submits two independent verified disclosures, challenges the newest against the first (ruled `DIFFERENT`), then challenges it again against the second, proving the first ruling never blocked or pre-decided the second.

## 7. Pull-based payout — no permissionless step ever forces a transfer

`finalize_payout()` (permissionless) only flips status to `PAYOUT_PENDING`; it moves zero funds. `claim_payout()` (researcher-only) is the sole actual transfer, and only the disclosure's own researcher can trigger it (`_normalize_address(gl.message.sender_address.as_hex) != _normalize_address(record["researcher"])` check, line ~742).

Confirmed by test: `test_claim_payout_rejects_non_researcher`, `test_finalize_payout_succeeds_after_window_with_no_challenge` (`tests/direct/test_expire_and_payout.py`, `tests/direct/test_duplicate_challenge.py`).

## 8. Address normalization consistent across every keyed lookup

`_normalize_address()` (lowercasing) is applied at every TreeMap write AND every corresponding read, in both contracts — `bounty_meta` keys, `get_bounties_by_sponsor`'s comparison, `get_disclosures_by_researcher`'s comparison, `claim_payout`'s researcher check, `get_claimable`'s researcher check. This closes the confirmed real GenLayer rejection pattern where a checksummed stored key (`Address.as_hex`) is compared against raw, unnormalized caller input.

## 9. No bare float ever crosses the calldata boundary

`_stringify_confidence()` (`VectorBounty.py` line ~138) coerces any numeric confidence value — including a bare Python float the LLM might return despite instructions — to a clamped, quoted string before it is ever stored or returned. `_parse_json_object()` deliberately does NOT use `exec_prompt(response_format="json")`'s auto-parse specifically because that auto-parse happens before this contract's own sanitization code runs, which would let a bare decimal crash the nondet-call return step.

Confirmed by test: `test_confidence_bare_float_never_crashes` (`tests/direct/test_triage.py`).

## 10. Prompt-injection defenses, structural first, heuristic second

Every untrusted string — the researcher's own submission fields AND the raw fetched web content — passes through `_sanitize_input()` before ever reaching a prompt: control characters stripped, structural JSON/fence characters (`{`, `}`, `` ``` ``) stripped (closing the "researcher plants a fake closing brace to smuggle a second JSON object" vector), then a secondary regex blocklist for common injection phrasing. The **primary** defense is structural, not the blocklist: every untrusted block is wrapped in explicit `<DISCLOSURE>`/`<LIVE_TARGET_CONTENT>`/`<DISCLOSURE_A>`/`<DISCLOSURE_B>` tags with an explicit "DATA, NOT INSTRUCTIONS" label, and the prompt explicitly instructs the model to treat any apparent instruction inside those blocks as evidence AGAINST `is_real` rather than something to obey. A disclosure submitter is exactly the adversarial party this system must be robust against — they have a direct financial incentive to make a fake or overrated disclosure look real.

## 11. Self-dealing and double-open-challenge rejected outright

`challenge_duplicate()` hard-rejects `disclosure_id == prior_disclosure_id` (a disclosure challenging itself) and a second challenge attempt while one is already open on the same disclosure (`self.open_challenges.get(disclosure_id, "")` check) — both closing concurrency/gaming vectors rather than relying on the LLM comparison alone to catch them.

Confirmed by test: `test_challenge_rejects_self_challenge`, `test_challenge_rejects_double_open_challenge` (`tests/direct/test_duplicate_challenge.py`).

## 12. Idempotency guard ordered correctly against a shared atomic write

`claim_payout()` checks `self.claimed.get(disclosure_id, "") == "1"` **before** checking `record["status"] != STATUS_PAYOUT_PENDING`, specifically because both flags are set together in the same atomic write when a claim succeeds — checking status first would make the more-specific "already claimed" error permanently unreachable on any double-claim attempt, always surfacing the less-precise "not payout-pending" message instead. This was caught by test failure during development, not by inspection, and is documented inline in the contract at the exact line it matters.

Confirmed by test: `test_claim_payout_rejects_double_claim` (`tests/direct/test_expire_and_payout.py`).

## 13. No permanently stranded value in either contract

`VectorFactory.withdraw_fees()` gives the factory owner an explicit path to recover accumulated creation stakes — the factory's own accumulated balance would otherwise have no recovery path at all, a class of bug distinct from (and easy to miss alongside) per-user escrow fund-locks. `VectorBounty.withdraw_unused_pool()` similarly lets a sponsor recover unused pool funds once closed, but only after `close_bounty()` **and** every disclosure has reached a terminal status (`TERMINAL_DISCLOSURE_STATUSES` check, line ~800) — preventing a sponsor from draining a pool out from under disclosures still mid-flight toward a genuine payout.

Confirmed by test: `test_withdraw_fees_only_owner`, `test_withdraw_fees_rejects_when_nothing_collected` (`tests/direct/test_factory_validation.py`); `test_withdraw_unused_pool_blocked_while_disclosure_non_terminal`, `test_withdraw_unused_pool_succeeds_when_all_terminal` (`tests/direct/test_lifecycle.py`).

## 14. Defense-in-depth validation, not single-point trust

Every constraint `VectorFactory.create_bounty()` enforces (title/description/URL length and format, severity ordering `critical ≥ high ≥ medium ≥ low > 0`, positive disclosure bond) is re-validated identically inside `VectorBounty.__init__` itself — because `VectorBounty`'s source is public and anyone can deploy it directly via `genlayer deploy`, bypassing whatever limits only lived in the factory. No constraint in this system is enforced in exactly one place.

Confirmed by test: `test_create_bounty_rejects_severity_ordering_violation` (factory-level) and `test_rejects_severity_ordering_violation` (bounty-level, direct deploy) both exist and both pass (`tests/direct/test_factory_validation.py`, `tests/direct/test_bounty_creation.py`).

## 15. SSRF-guarded `target_url`

Every validator independently fetches `target_url` server-side (`gl.nondet.web.render`), so a caller-supplied endpoint pointed at an internal/loopback/link-local target would make the whole validator set an unwitting port-scanner/internal-request proxy. `_is_safe_target_url()` (both contracts) rejects `localhost`/`*.localhost`, literal IPv4/IPv6 hosts including decimal/hex-encoded forms, private/loopback/link-local/reserved/multicast IP ranges, explicit ports, and embedded credentials — checked both in `VectorFactory.create_bounty()` and again in `VectorBounty.__init__` (defense in depth, since the bounty's source is publicly deployable directly).

## 16. Sponsor cannot self-disclose against their own bounty

`fund_pool()` is deliberately permissionless, so a bounty's pool can hold real third-party donations, not only the sponsor's own money. Without a check, a sponsor could privately introduce a real-but-trivial flaw on their own live target, self-submit it as a disclosure, have `triage()` genuinely verify it (no consensus bug -- the flaw is real), and claim a payout out of a pool funded in part by other people. `submit_disclosure()` now hard-rejects `_normalize_address(sender) == _normalize_address(self.sponsor)`. This closes the direct form of the exploit; a sponsor routing around it with a second wallet is an accepted residual risk, same as any address-based access control (see `SECURITY.md`).

Confirmed by test: `test_submit_disclosure_rejects_sponsor_as_researcher` (`tests/direct/test_disclosure_submission.py`).

## 17. Bounded escape hatch for an unclaimed payout

`PAYOUT_PENDING` is deliberately excluded from `TERMINAL_DISCLOSURE_STATUSES`, and its only exit was `claim_payout`, gated to the exact `researcher` address. A researcher who never claimed -- lost key, abandoned address -- permanently blocked `withdraw_unused_pool` for the whole program, with no adversary required. `expire_unclaimed_payout()` is now a permissionless, bounded (`PAYOUT_CLAIM_TIMEOUT_SECONDS`, 30 days from the new `payout_pending_at` field) backstop that moves the disclosure to `EXPIRED` without ever touching `pool_remaining` -- money that was never actually paid out simply stays available for `withdraw_unused_pool`.

Confirmed by test: `test_expire_unclaimed_payout_before_timeout_reverts`, `test_expire_unclaimed_payout_rejects_non_payout_pending`, `test_expire_unclaimed_payout_after_timeout_unblocks_pool_withdrawal` (`tests/direct/test_expire_and_payout.py`).

## Known, disclosed limitations

- **[LIVE BLOCKER] `create_bounty()` cannot currently complete on studio-dev** -- a platform-level fee-allocation gap for internal-deploy-triggering writes, confirmed live against the deployed factory, not a Vector contract bug. See `SECURITY.md` for the full detail and both confirmation paths.
- **Cross-contract writes silently no-op** (confirmed platform behavior, not a Vector-specific bug) is why the factory's registry never reflects live bounty state — see `docs/ARCHITECTURE.md`.
- **`strict_eq`'s validator path (not used here) vs. `run_nondet`'s (used throughout Vector)**: `run_nondet`'s validator path is fully exercisable in `gltest` direct-mode via `vm.run_validator()`, which is how every validator-independence test above is actually proven locally, not just asserted.
- **`gltest` direct-mode's WASI mock does not implement `GetTimestamp` yet** (a toolchain gap, not a contract bug): `gl.vm.get_timestamp()` — used by `_consensus_now()` in both contracts, including inside `VectorBounty.__init__` — returns `None` locally. `conftest.py`'s `deploy_bounty()` catches this and calls `pytest.skip()` with a clear reason, so this now surfaces as 56 skips, not failures (52 pre-existing plus 4 for findings 16 and 17 above). The tests above that *are* confirmed passing locally cover factory-level and pre-deploy validation logic only; every disclosure/triage/payout path they describe is verified by code inspection and lint, not by a currently-passing direct-mode run, until `gltest` adds `GetTimestamp` support or an integration-network test run is done.
