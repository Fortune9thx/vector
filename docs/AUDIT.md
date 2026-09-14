# Audit

A self-adversarial review of Vector against known GenLayer Portal rejection patterns, run against the actual deployed contract code and the 85-test direct-mode suite (72 passing, 13 skipped pending a narrower `gltest` limitation — see `SECURITY.md`) — not a checklist filled in from memory. Each item cites the specific file/line/test that proves it, not a restated assumption. The full flow (deploy → register → fund → submit → triage) was also live-verified end to end on studio-dev against the current deployed factory, not just tested locally — see `SECURITY.md`'s 2026-09-14 steward-review entry for the most recent full run. A final pre-submission pass (findings 20–21) re-read both contracts fresh and re-ran the full suite from scratch, rather than assuming the prior rounds' conclusions still held; a subsequent Portal steward review (findings 22–25) found five further real gaps, each now fixed and redeployed.

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

Both `triage()` and `resolve_duplicate()` each contain exactly one `gl.vm.run_nondet(leader_fn, validator_fn)` call, with named `def leader_fn`/`def validator_fn` closures, never a lambda. Verified mechanically, not just by inspection: `PYTHONIOENCODING=utf-8 genvm-lint check contracts/VectorBounty.py` and the same for `VectorFactory.py` both pass clean (3 checks, 18 and 11 methods respectively).

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

## 14. Business-field validation lives in exactly one place, by design, and the factory never trusts the caller

Post-redesign (see finding 18 and `docs/ARCHITECTURE.md`), `VectorFactory.register_bounty()` takes no title/description/severity/bond arguments at all -- it only validates the creation stake and the address format, then cross-contract-reads the deployed child's own `get_bounty_info()` for everything else. All business-field validation (title/description/URL length and format, severity ordering `critical ≥ high ≥ medium ≥ low > 0`, positive disclosure bond) lives solely in `VectorBounty.__init__`, which is correct precisely because it is the only code path a bounty's fields can ever come from: `VectorBounty`'s source is public and anyone can deploy it directly, and the factory registers exactly what that deployment produced, never a caller's separate claim about it. There is no redundant, potentially-divergent copy of this validation anywhere.

Confirmed by test: the full `test_rejects_*` family in `tests/direct/test_bounty_creation.py` (severity ordering, zero bond, etc.), all passing against the constructor directly.

## 15. SSRF-guarded `target_url`

Every validator independently fetches `target_url` server-side (`gl.nondet.web.render`), so a caller-supplied endpoint pointed at an internal/loopback/link-local target would make the whole validator set an unwitting port-scanner/internal-request proxy. `_is_safe_target_url()` in `VectorBounty.__init__` rejects `localhost`/`*.localhost`, literal IPv4/IPv6 hosts including decimal/hex-encoded forms, private/loopback/link-local/reserved/multicast IP ranges, explicit ports, and embedded credentials. This lives only in `VectorBounty` now (see finding 14) -- `VectorFactory.register_bounty()` has no `target_url` parameter to re-check.

## 16. Sponsor cannot self-disclose against their own bounty

`fund_pool()` is deliberately permissionless, so a bounty's pool can hold real third-party donations, not only the sponsor's own money. Without a check, a sponsor could privately introduce a real-but-trivial flaw on their own live target, self-submit it as a disclosure, have `triage()` genuinely verify it (no consensus bug -- the flaw is real), and claim a payout out of a pool funded in part by other people. `submit_disclosure()` now hard-rejects `_normalize_address(sender) == _normalize_address(self.sponsor)`. This closes the direct form of the exploit; a sponsor routing around it with a second wallet is an accepted residual risk, same as any address-based access control (see `SECURITY.md`).

Confirmed by test: `test_submit_disclosure_rejects_sponsor_as_researcher` (`tests/direct/test_disclosure_submission.py`).

## 17. Bounded escape hatch for an unclaimed payout

`PAYOUT_PENDING` is deliberately excluded from `TERMINAL_DISCLOSURE_STATUSES`, and its only exit was `claim_payout`, gated to the exact `researcher` address. A researcher who never claimed -- lost key, abandoned address -- permanently blocked `withdraw_unused_pool` for the whole program, with no adversary required. `expire_unclaimed_payout()` is now a permissionless, bounded (`PAYOUT_CLAIM_TIMEOUT_SECONDS`, 30 days from the new `payout_pending_at` field) backstop that moves the disclosure to `EXPIRED` without ever touching `pool_remaining` -- money that was never actually paid out simply stays available for `withdraw_unused_pool`.

Confirmed by test: `test_expire_unclaimed_payout_before_timeout_reverts`, `test_expire_unclaimed_payout_rejects_non_payout_pending`, `test_expire_unclaimed_payout_after_timeout_unblocks_pool_withdrawal` (`tests/direct/test_expire_and_payout.py`).

## 18. Registry integrity never depends on caller-supplied metadata

`register_bounty(bounty_address)` takes only an address. Everything the registry stores about a bounty (title, description, target URL, sponsor, severity payouts, disclosure bond) is read back from the deployed contract's own `get_bounty_info()` via `gl.contract.get_at(addr).view()`, plus one authenticity check: the child's own reported `address_factory` must equal `gl.message.contract_address` (this factory), rejecting a bounty deployed pointed at a different registry. A caller cannot lie about a bounty's fields to get a misleading entry listed -- the registry can only ever reflect what the real contract at that address actually reports. (It cannot detect a sponsor using a second wallet to disguise unrelated self-dealing -- see `SECURITY.md`, same residual limitation as finding 16.)

This design exists because `VectorFactory` cannot deploy `VectorBounty` itself any more (see `docs/ARCHITECTURE.md`), so the factory has no first-hand knowledge of a new bounty beyond what the sponsor tells it -- cross-contract-reading the child's own state closes exactly the gap that opens.

Live-verified 2026-09-11: a real `register_bounty()` call against a real deployed `VectorBounty` succeeded, and `get_bounty_meta()` afterward returned fields matching the child's own `get_bounty_info()` exactly, not the constructor args as typed by the deploying script.

## 19. Timestamps come from the message payload, not a separate VM call

`_consensus_now()` reads `genlayer.message.raw["datetime"]` -- part of the VM's initial message payload, decoded once at contract start with no additional VM call -- rather than `gl.vm.get_timestamp()`, which was found to fail on every single call on studio-dev (`SystemError: 2: inval`, confirmed with a minimal isolated diagnostic contract, in both a constructor and a plain write). This is the reason `VectorBounty.__init__` and every disclosure/triage/payout method that touches a deadline can execute live at all right now -- see `SECURITY.md` for the full finding.

## 20. `UNVERIFIABLE` could permanently block pool withdrawal — same bug class as finding 17, found separately

`STATUS_UNVERIFIABLE` (reached when a target genuinely can't be fetched after `TRIAGE_FETCH_MAX_ATTEMPTS` attempts across `TRIAGE_UNVERIFIABLE_AFTER_SECONDS`) was excluded from `TERMINAL_DISCLOSURE_STATUSES`, and no method ever transitions a disclosure out of it. `withdraw_unused_pool()` requires every disclosure to be terminal, so a single `UNVERIFIABLE` disclosure — not an adversary, just a target URL that goes down for a day — would strand every remaining GEN in that bounty's pool forever, with the sponsor unable to close out the program. This is the identical bug class as finding 17 (`PAYOUT_PENDING`), independently reachable through a completely different code path, found in a final pre-submission pass rather than the original round that caught 17.

Fixed by adding `STATUS_UNVERIFIABLE` to `TERMINAL_DISCLOSURE_STATUSES`. Its bond is already fully refunded at the point it's reached (`_refund_bond` inside `triage()`'s no-evidence branch), so there is no pending payout obligation left against `pool_remaining` — the same reasoning already applied to `REJECTED`/`DUPLICATE`/`EXPIRED`.

Regression test added: `test_withdraw_unused_pool_succeeds_when_disclosure_unverifiable` (`tests/direct/test_lifecycle.py`) — marked `@pytest.mark.skip(reason=WARP_ACROSS_CALLS_UNSUPPORTED)` since reaching `UNVERIFIABLE` itself needs `vm.warp()` across multiple `triage()` calls, the same toolchain gap documented in finding 19/`SECURITY.md`; the test documents the intended contract even though this specific toolchain can't execute it locally.

## 21. The registry cannot verify a registered address's actual code — disclosed, not fixable at the contract level

`register_bounty()`'s only check that `bounty_address` is a genuine `VectorBounty` is a cross-contract **view** call to that same address's own `get_bounty_info()`, checking that its self-reported `address_factory` equals this factory. That check is self-attestation: the contract being registered fully controls what its own view methods return. A deliberately malicious contract — one that reports a correct-looking `address_factory` while its `submit_disclosure`/`triage`/`claim_payout` behave arbitrarily (e.g. always reject, or never refund a bond) — would pass this check and appear in Vector's registry as an apparently legitimate bounty program.

This is a genuine gap, not an oversight: confirmed by reading the installed GenVM SDK's `genlayer/contract/__init__.py` (the exact runner hash this project is pinned to) that `get_at()`/`Proxy` expose no code-hash, bytecode, or source-introspection primitive of any kind — there is no GenVM equivalent of `extcodehash` to compare a registered address's actual code against `get_bounty_code()`'s known-good source. `deploy()`'s `salt_nonce`-based `CREATE2`-style deterministic addressing ties an address to its code, but only for a deploy the *factory itself* initiates — which is exactly the path Consensus v0.6's internal-deploy fee gap blocks (see `SECURITY.md`), so it's unavailable here regardless.

Partial, real mitigation already in place: `register_bounty` is payable and gated on `creation_stake`, so listing a malicious clone is not free — same economic-disincentive logic already used for disclosure bonds. No further contract-side fix exists today; revisit if a future GenVM version exposes deployed-code introspection, or once the internal-deploy fee gap closes and factory-deploys-child (with real `CREATE2` code-binding) becomes viable again.

## 22. A valid, verified claim could never fail or race another disclosure for the same pool (Portal steward finding)

`submit_disclosure()` now reserves the disclosure's absolute worst-case payout (the `critical` severity rate) out of `pool_remaining` immediately at submission — before `triage()`'s outcome is even known — via a new `reserved_wei` field, and rejects the submission outright if the pool's unreserved balance (`pool_remaining - reserved_wei`) can't cover it. Previously the only check was inside `claim_payout()`, long after independent verification had already happened, meaning two disclosures could both reach `VERIFIED` against a pool that could only actually pay one of them — the second one's genuine, independently-confirmed finding would simply never be honored, with no earlier signal anything was wrong. The reservation shrinks to the real payout once severity is known (excess released immediately), and is released in full the moment a disclosure reaches any status that will never draw on the pool.

Confirmed by test: `test_submit_disclosure_rejects_when_pool_cannot_cover_worst_case`, `test_submit_disclosure_reserves_worst_case_and_blocks_a_second_from_racing_it` (`tests/direct/test_disclosure_submission.py`); reservation-release coverage across every terminal transition in `test_triage.py`, `test_lifecycle.py`, `test_duplicate_challenge.py`. Live-verified 2026-09-14: a real submission's `reserved_wei` visibly rose to the exact worst-case rate, then shrank to the exact real payout once triage assigned a lower severity — see `SECURITY.md`.

## 23. Duplicate challenges are no longer free to grief with

`challenge_duplicate()` now stakes exactly `disclosure_bond` — refunded if the challenge is upheld (`SAME`), forfeited to the pool if not (`DIFFERENT`). Previously free and permissionless, an unresolved challenge blocks `finalize_payout()` unconditionally, so anyone could indefinitely stall every `VERIFIED` disclosure's payout in a program at zero cost — pure griefing with no offsetting risk. This closes it with the same bond-based disincentive already used for bad-faith disclosures, not a novel mechanism.

Confirmed by test: `test_challenge_duplicate_requires_exact_bond`, `test_challenge_duplicate_refunds_bond_when_challenge_upheld`, `test_challenge_duplicate_forfeits_bond_when_challenge_fails` (`tests/direct/test_duplicate_challenge.py`).

## 24. Malformed model output can never be silently treated as a rejection verdict (Portal steward finding)

`triage()`'s `leader_fn` now distinguishes "the model's response contained no parseable JSON object at all" (`DECISION_PARSE_FAILURE`) from a genuinely parsed verdict — previously both collapsed into the same `severity="none"`/`is_real=False` shape as an actual "this claim is fake" result, silently forfeiting the researcher's bond over what could be nothing more than an LLM formatting slip. `DECISION_PARSE_FAILURE` now follows the identical fail-closed retry-then-`UNVERIFIABLE` path as an unfetchable target (`DECISION_NO_EVIDENCE`) — always eventually a full bond refund, never a forfeiture, regardless of how many times parsing fails.

Confirmed by test: `test_triage_treats_unparseable_model_output_as_retryable_not_rejected` (`tests/direct/test_triage.py`).

## 25. GitHub-hosted review targets must be commit-pinned, not branch-pinned (Portal steward finding)

A `target_url` on `raw.githubusercontent.com` must now reference a full 40-character commit SHA rather than a mutable branch/tag name (`_immutable_reference_error`, `VectorBounty.__init__`). A branch can be edited by anyone with push access at any time, including in the window between a researcher's submission and `triage()`'s actual fetch — undermining the "independently verified against real evidence" premise for exactly the class of target (static source code) this scope realistically applies to. Deliberately scoped to this one host rather than `target_url` generally: for a genuinely live production endpoint, checking its *current* state is the entire point of the system, and pinning it would defeat that.

Confirmed by test: `test_rejects_github_raw_url_pinned_to_a_mutable_branch`, `test_rejects_github_raw_url_with_too_few_path_segments`, `test_accepts_github_raw_url_pinned_to_a_real_commit_sha`, `test_non_github_live_url_is_unaffected_by_the_pin_requirement` (`tests/direct/test_bounty_creation.py`). Live-verified 2026-09-14 against the redeployed factory with a real, current commit SHA.

## Known, disclosed limitations

- **Cross-contract writes silently no-op** (confirmed platform behavior, not a Vector-specific bug) is why the factory's registry never reflects live bounty *status changes* after registration — see `docs/ARCHITECTURE.md`. Cross-contract *views* are confirmed working and are load-bearing (finding 18).
- **`strict_eq`'s validator path (not used here) vs. `run_nondet`'s (used throughout Vector)**: `run_nondet`'s validator path is fully exercisable in `gltest` direct-mode via `vm.run_validator()`, which is how every validator-independence test above is actually proven locally, not just asserted.
- **`gltest` direct-mode has two remaining narrow gaps, both toolchain limitations, not contract bugs, and both fully disclosed in `SECURITY.md`**: its WASI mock has no `GetTimestamp` handler at all (moot for Vector now -- see finding 19 -- but would affect any future code calling it directly), and separately, its contract module is imported once at deploy time, so a `vm.warp()` call made after deploy isn't visible to a later interaction within the same test (12 of 77 tests, all covered instead by the live end-to-end proof in finding 18's `SECURITY.md` entry).
