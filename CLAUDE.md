# Vector — CLAUDE.md

Vector is a GenLayer **Intelligent Contract** project: a verified vulnerability disclosure escrow. Security researchers disclose vulnerabilities against a live public target; GenLayer validators independently fetch that real target and verify the disclosure is genuine and correctly severity-rated before any bounty pays out. There is no centralized triage team anywhere in the system.

Primary deploy target: **GenLayer Studio Devnet** (`studio-dev`, the Consensus v0.6 release-candidate network — see docs.genlayer.com/developers/consensus-v06-migration). Contracts are written to the v0.3.0 `genlayer` API and pinned to a Consensus-v0.6-compatible `py-genlayer` runner hash; they are no longer deployable against the old stable Bradbury runner without reverting the API changes below. `deploy/001_deploy_vector_factory.ts` still defaults its `network` arg to `"bradbury"` for historical reasons — pass `studio-dev` explicitly (`npx tsx deploy/001_deploy_vector_factory.ts studio-dev`).

## Ground rules for any agent working in this repo

1. **Always run `PYTHONIOENCODING=utf-8 genvm-lint check contracts/VectorFactory.py && PYTHONIOENCODING=utf-8 genvm-lint check contracts/VectorBounty.py`** after any contract change, and fix every issue before considering the change done. Passing live tests is *not* sufficient evidence of lint-cleanliness.
2. **Always prefer direct-mode tests first** (`tests/direct/`, via `gltest`) before touching the integration/Studio/Bradbury path.
3. **Follow the official genlayer-dev skill / docs patterns** — https://docs.genlayer.com. When a pattern here diverges from generic Python/Solidity intuition, trust the GenLayer-specific docs and this file over instinct.
4. **Security is non-negotiable** — see `docs/AUDIT.md`. Every change touching prompt construction, user input handling, or output parsing must be checked against it before merging.

## Architecture

- `VectorFactory.py` — a registry + on-chain factory. `create_bounty()` deploys a fresh `VectorBounty` instance per program via `gl.contract.deploy`. The only privileged action anywhere in the system is `withdraw_fees()` (recovering the factory's own accumulated creation stakes). `create_bounty` is permissionless, gated only by the economic creation stake.
- `VectorBounty.py` — one deployed instance per bounty program, against one live public target. Owns the full disclosure state machine: `PENDING → TRIAGING → (UNVERIFIABLE | REJECTED | VERIFIED) → PAYOUT_PENDING → PAID`, with `DUPLICATE` and `EXPIRED` as additional terminal states.
- Registry metadata in the factory (`bounty_meta`) is creation-time only — read-only, never updated after deploy. Live disclosure state changes continuously inside each `VectorBounty` and must be read directly from it; cross-contract writes are confirmed to silently no-op on GenLayer intelligent-contract-to-intelligent-contract calls, so there is no way for a `VectorBounty` to push state updates back to the factory.
- Pool funding (`fund_pool()`) is a direct payable call to a bounty's own address, never money forwarded through the factory — cross-contract native-value transfers to another Intelligent Contract are a documented real platform gap.

## Consensus v0.6 / studio-dev migration (current state)

Both contracts were migrated from the old stable `genlayer` API to the v0.3.0 API required by Consensus v0.6 / Studio Devnet:

- `import genlayer.gl as gl` → `import genlayer as gl`; `from genlayer import *` → `from genlayer.types import *`; `TreeMap`/`DynArray` now come from `from genlayer.storage import DynArray, TreeMap`.
- `class X(gl.Contract):` → `class X(gl.contract.Contract):`.
- `gl.deploy_contract(...)` → `gl.contract.deploy(...)` (same call shape).
- `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)` → `gl.vm.run_nondet(leader_fn, validator_fn)` (same "unsandboxed validator" semantics, just renamed).
- `gl.message_raw["datetime"]` + manual ISO parsing → `gl.vm.get_timestamp().timestamp()` (see `_consensus_now()` in both files).
- Header is now the two-line form used by every current official example: `# v0.3.0` then `# { "Depends": "py-genlayer:<hash>" }`.
- **Runner-hash platform bug**: Studio Devnet's registry currently fails to resolve several `py-genlayer` hashes (including the one GenLayer's own official `v2-dev` examples pin) with `invalid_contract runner malformed`/`runner absent` — filed as [genlayerlabs/genlayer-studio#1757](https://github.com/genlayerlabs/genlayer-studio/issues/1757), unresolved as of 2026-09-11. Both contracts here are pinned to `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng`, confirmed live via `gen_getContractSchemaForCode` to be the one hash in this family that actually resolves right now. If a future deploy attempt fails with either of those runner errors, check that GitHub issue before assuming it's a contract bug, and re-probe with a fresh no-gas `getContractSchemaForCode` call before touching the pin again.
- `gltest` direct-mode's WASI mock does **not** implement `GetTimestamp` yet, so `gl.vm.get_timestamp()` returns `None` in every direct-mode test — this will crash `_consensus_now()` in any direct-mode test that exercises a timestamp-touching path (bounty creation, `submit_disclosure`, `triage`, expiry). This is a toolchain gap, not a contract bug — do not monkeypatch around it; time-dependent paths need an integration-network test until `gltest` catches up.

## Verified platform constraints (current build)

- **Storage:** only `TreeMap[str, str]` (JSON-encoded values) and `DynArray[str]` are used — matching every prior GenLayer project on this account. No `@allow_storage` dataclass TreeMap value type, by deliberate choice (see `docs/AUDIT.md`).
- **No float in calldata:** GenVM calldata encoding has no float type. `confidence` is always a quoted JSON string end to end — parsed with `float()` for internal comparisons, always re-stringified before storage or return.
- **One non-deterministic call per method:** `genvm-lint` requires exactly one top-level `gl.vm.run_nondet` call per write method, and the leader function must be a named `def`, never an inline `lambda`.
- **Validator independence:** `triage()`'s `validator_fn` calls the same `leader_fn` again — re-fetching the live target and re-running the LLM from scratch — then compares the two independently-derived results. It never validates the leader's own claimed output structurally only.
- **Evidence binding:** `evidence_snapshot` is sliced directly from the real fetched content inside `leader_fn`, never from the LLM's own self-report of what it looked at.
- **Fail-closed on no evidence:** if the live target can't be fetched at all, there is no LLM call — every validator independently agrees on `DECISION_NO_EVIDENCE` without needing model agreement on anything.
- **Cross-contract calls:** reads via `.view()` work reliably; writes via `.emit()` are confirmed to silently no-op. Vector never performs cross-contract writes for this reason.
- **Errors:** `gl.vm.UserError("message")` for user-facing reverts, never bare `raise Exception(...)`.
- **Timestamps:** `gl.vm.get_timestamp()` (the transaction's own consensus timestamp, timezone-aware `datetime`), never each node's local wall clock.
- **`genvm-lint` on Windows:** its checkmark glyph crashes cp1252 stdout — always prefix with `PYTHONIOENCODING=utf-8`.

## Toolchain (Windows)

- Python: `C:\Users\HP\AppData\Local\Programs\Python\Python312\python.exe` (not on PATH by default).
- `pip install genlayer-test genvm-linter python-dotenv --pre` — provides `gltest` (direct-mode pytest plugin) and `genvm-lint` at the RC versions matching Consensus v0.6 (`genlayer-test==0.30.0rc2`, `genvm-linter==0.11.1rc2` at time of writing; check `pip index versions <pkg> --pre` before assuming these are current).
- Node/npm live at `C:\Users\HP\nodejs`, not on PATH by default. `genlayer-js` is pinned to the `2.0.0-rc.1` family in `package.json` — required for the `studioDevnet` chain preset and v0.6 fee estimation; do not downgrade it to a stable release while targeting studio-dev.

## Deployment / GitHub / Vercel

These are **never** performed autonomously. Always stop and get explicit confirmation from the user immediately before: switching the active wallet/account, switching network, running an actual deploy transaction, creating or pushing to a GitHub repo, or deploying to Vercel — even mid-task, even after a general go-ahead earlier in the conversation.

### Deploy troubleshooting

- **Verify code persisted** after a deploy: `genlayer code <address>` should return the exact source.
- **A transient revert** is usually safe to retry once — check `txExecutionResultName`, not just `status_name: ACCEPTED`.
- Contracts have no upgrade mechanism — a contract-source fix always means a fresh deploy at a new address (a new `VectorFactory`, since `bounty_code` is embedded in it at deploy time). Update `frontend/lib/contracts.ts`, `README.md`, and `docs/AUDIT.md` together whenever the canonical address changes.
