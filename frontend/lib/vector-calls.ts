import type { GenLayerClient, GenLayerChain } from "genlayer-js/types";
import { VECTOR_FACTORY_METHODS, VECTOR_BOUNTY_METHODS } from "./vector-abi";
import type { BountyMeta, BountyInfo, DisclosureRecord } from "./vector-abi";

// ---------------------------------------------------------------------
// VectorFactory reads/writes. Return values are dicts/lists that
// genlayer-js's readContract decodes to plain JSON-safe JS objects by
// default (jsonSafeReturn defaults to true), so no manual JSON parsing is
// needed anywhere below.
// ---------------------------------------------------------------------

export async function fetchBounties(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`
): Promise<string[]> {
  const result = await client.readContract({
    address: factoryAddress,
    functionName: VECTOR_FACTORY_METHODS.getBounties,
    args: [],
  });
  return result as unknown as string[];
}

export async function fetchBountyMeta(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`,
  bountyAddress: string
): Promise<BountyMeta> {
  const result = await client.readContract({
    address: factoryAddress,
    functionName: VECTOR_FACTORY_METHODS.getBountyMeta,
    args: [bountyAddress],
  });
  return result as unknown as BountyMeta;
}

export async function fetchOwner(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`
): Promise<string> {
  const result = await client.readContract({
    address: factoryAddress,
    functionName: VECTOR_FACTORY_METHODS.getOwner,
    args: [],
  });
  return result as unknown as string;
}

export async function fetchCreationStake(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`
): Promise<string> {
  const result = await client.readContract({
    address: factoryAddress,
    functionName: VECTOR_FACTORY_METHODS.getCreationStake,
    args: [],
  });
  return result as unknown as string;
}

export async function fetchCollectedFees(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`
): Promise<string> {
  const result = await client.readContract({
    address: factoryAddress,
    functionName: VECTOR_FACTORY_METHODS.getCollectedFees,
    args: [],
  });
  return result as unknown as string;
}

export async function fetchBountiesBySponsor(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`,
  sponsor: string
): Promise<string[]> {
  const result = await client.readContract({
    address: factoryAddress,
    functionName: VECTOR_FACTORY_METHODS.getBountiesBySponsor,
    args: [sponsor],
  });
  return result as unknown as string[];
}

/**
 * The exact VectorBounty source to deploy -- fetched live from the factory
 * rather than bundled statically, so a sponsor's deploy always matches
 * what register_bounty() will actually accept (see VectorFactory's own
 * docstring for why bounty creation is deploy-then-register rather than
 * factory-deploys-child: a Consensus v0.6 platform gap means any write
 * that itself triggers an internal gl.contract.deploy() cannot currently
 * complete -- confirmed live, unrelated to this contract's code, see
 * SECURITY.md).
 */
export async function fetchBountyCode(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`
): Promise<string> {
  const result = await client.readContract({
    address: factoryAddress,
    functionName: VECTOR_FACTORY_METHODS.getBountyCode,
    args: [],
  });
  return result as unknown as string;
}

/**
 * Step 1 of 2: the sponsor deploys VectorBounty directly, as an ordinary
 * top-level transaction -- gl.message.sender_address inside its __init__
 * is already genuinely the sponsor this way, no factory-hop capture
 * needed. Like every other write here this returns only the tx hash;
 * once useTransactionLifecycle polls it to FINALIZED, extract the
 * deployed address from the resulting transaction with
 * extractDeployedAddress() below (the same reliable pattern
 * deploy/001_deploy_vector_factory.ts uses for a top-level deploy).
 */
export async function deployBounty(
  client: GenLayerClient<GenLayerChain>,
  bountyCode: string,
  factoryAddress: `0x${string}`,
  title: string,
  description: string,
  targetUrl: string,
  severityCriticalWei: string,
  severityHighWei: string,
  severityMediumWei: string,
  severityLowWei: string,
  disclosureBondWei: string
): Promise<`0x${string}`> {
  const hash = await client.deployContract({
    code: bountyCode,
    args: [
      factoryAddress,
      title,
      description,
      targetUrl,
      severityCriticalWei,
      severityHighWei,
      severityMediumWei,
      severityLowWei,
      disclosureBondWei,
    ],
  });
  return hash as `0x${string}`;
}

/**
 * genlayer-js@1.1.8's GenLayerTransaction type puts a fresh top-level
 * deploy's address at txDataDecoded.contractAddress -- verified against
 * the installed package's own .d.ts, same as
 * deploy/001_deploy_vector_factory.ts's extraction.
 */
export function extractDeployedAddress(transaction: unknown): `0x${string}` | null {
  const tx = transaction as Record<string, unknown> & {
    txDataDecoded?: { contractAddress?: string };
  };
  const address =
    tx?.txDataDecoded?.contractAddress ??
    (tx?.contractAddress as string | undefined) ??
    (tx?.to_address as string | undefined);
  return (address as `0x${string}`) ?? null;
}

/**
 * Step 2 of 2: register the just-deployed bounty with the factory.
 * register_bounty cross-contract-reads the deployed child's own
 * get_bounty_info() -- the factory never trusts caller-supplied metadata,
 * only what the real deployed contract reports.
 */
export async function registerBounty(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`,
  bountyAddress: `0x${string}`,
  creationStakeWei: bigint
): Promise<`0x${string}`> {
  const hash = await client.writeContract({
    address: factoryAddress,
    functionName: VECTOR_FACTORY_METHODS.registerBounty,
    args: [bountyAddress],
    value: creationStakeWei,
  });
  return hash as `0x${string}`;
}

export async function withdrawFees(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`
): Promise<`0x${string}`> {
  const hash = await client.writeContract({
    address: factoryAddress,
    functionName: VECTOR_FACTORY_METHODS.withdrawFees,
    args: [],
    value: 0n,
  });
  return hash as `0x${string}`;
}

// ---------------------------------------------------------------------
// VectorBounty reads
// ---------------------------------------------------------------------

export async function fetchBountyInfo(
  client: GenLayerClient<GenLayerChain>,
  bountyAddress: `0x${string}`
): Promise<BountyInfo> {
  const result = await client.readContract({
    address: bountyAddress,
    functionName: VECTOR_BOUNTY_METHODS.getBountyInfo,
    args: [],
  });
  return result as unknown as BountyInfo;
}

export async function fetchDisclosure(
  client: GenLayerClient<GenLayerChain>,
  bountyAddress: `0x${string}`,
  disclosureId: string
): Promise<DisclosureRecord> {
  const result = await client.readContract({
    address: bountyAddress,
    functionName: VECTOR_BOUNTY_METHODS.getDisclosure,
    args: [disclosureId],
  });
  return result as unknown as DisclosureRecord;
}

export async function fetchDisclosures(
  client: GenLayerClient<GenLayerChain>,
  bountyAddress: `0x${string}`
): Promise<string[]> {
  const result = await client.readContract({
    address: bountyAddress,
    functionName: VECTOR_BOUNTY_METHODS.getDisclosures,
    args: [],
  });
  return result as unknown as string[];
}

export async function fetchDisclosuresByResearcher(
  client: GenLayerClient<GenLayerChain>,
  bountyAddress: `0x${string}`,
  researcher: string
): Promise<DisclosureRecord[]> {
  const result = await client.readContract({
    address: bountyAddress,
    functionName: VECTOR_BOUNTY_METHODS.getDisclosuresByResearcher,
    args: [researcher],
  });
  return result as unknown as DisclosureRecord[];
}

export async function fetchClaimable(
  client: GenLayerClient<GenLayerChain>,
  bountyAddress: `0x${string}`,
  disclosureId: string,
  address: string
): Promise<string> {
  const result = await client.readContract({
    address: bountyAddress,
    functionName: VECTOR_BOUNTY_METHODS.getClaimable,
    args: [disclosureId, address],
  });
  return result as unknown as string;
}

export async function fetchIsClaimed(
  client: GenLayerClient<GenLayerChain>,
  bountyAddress: `0x${string}`,
  disclosureId: string
): Promise<boolean> {
  const result = await client.readContract({
    address: bountyAddress,
    functionName: VECTOR_BOUNTY_METHODS.isClaimed,
    args: [disclosureId],
  });
  return result as unknown as boolean;
}

// ---------------------------------------------------------------------
// VectorBounty writes
// ---------------------------------------------------------------------

export async function fundPool(
  client: GenLayerClient<GenLayerChain>,
  bountyAddress: `0x${string}`,
  value: bigint
): Promise<`0x${string}`> {
  const hash = await client.writeContract({
    address: bountyAddress,
    functionName: VECTOR_BOUNTY_METHODS.fundPool,
    args: [],
    value,
  });
  return hash as `0x${string}`;
}

export async function submitDisclosure(
  client: GenLayerClient<GenLayerChain>,
  bountyAddress: `0x${string}`,
  title: string,
  description: string,
  reproSteps: string,
  targetRef: string,
  claimedSeverity: string,
  value: bigint
): Promise<`0x${string}`> {
  const hash = await client.writeContract({
    address: bountyAddress,
    functionName: VECTOR_BOUNTY_METHODS.submitDisclosure,
    args: [title, description, reproSteps, targetRef, claimedSeverity],
    value,
  });
  return hash as `0x${string}`;
}

// triage() is the heaviest call in this contract: a full nondet
// live-web-fetch + LLM-reasoning round, re-run independently by every
// validator for Equivalence Principle agreement. Raised above the SDK's
// default consensusMaxRotations (3) for the same reason every prior
// GenLayer project on this stack raises it for its heaviest write -- more
// surface for one slow/failed leader attempt to eat the default budget
// before the platform gives up.
const TRIAGE_MAX_ROTATIONS = 5;

export async function triage(
  client: GenLayerClient<GenLayerChain>,
  bountyAddress: `0x${string}`,
  disclosureId: string
): Promise<`0x${string}`> {
  const hash = await client.writeContract({
    address: bountyAddress,
    functionName: VECTOR_BOUNTY_METHODS.triage,
    args: [disclosureId],
    value: 0n,
    consensusMaxRotations: TRIAGE_MAX_ROTATIONS,
  });
  return hash as `0x${string}`;
}

export async function challengeDuplicate(
  client: GenLayerClient<GenLayerChain>,
  bountyAddress: `0x${string}`,
  disclosureId: string,
  priorDisclosureId: string
): Promise<`0x${string}`> {
  const hash = await client.writeContract({
    address: bountyAddress,
    functionName: VECTOR_BOUNTY_METHODS.challengeDuplicate,
    args: [disclosureId, priorDisclosureId],
    value: 0n,
  });
  return hash as `0x${string}`;
}

const RESOLVE_DUPLICATE_MAX_ROTATIONS = 5;

export async function resolveDuplicate(
  client: GenLayerClient<GenLayerChain>,
  bountyAddress: `0x${string}`,
  disclosureId: string
): Promise<`0x${string}`> {
  const hash = await client.writeContract({
    address: bountyAddress,
    functionName: VECTOR_BOUNTY_METHODS.resolveDuplicate,
    args: [disclosureId],
    value: 0n,
    consensusMaxRotations: RESOLVE_DUPLICATE_MAX_ROTATIONS,
  });
  return hash as `0x${string}`;
}

export async function finalizePayout(
  client: GenLayerClient<GenLayerChain>,
  bountyAddress: `0x${string}`,
  disclosureId: string
): Promise<`0x${string}`> {
  const hash = await client.writeContract({
    address: bountyAddress,
    functionName: VECTOR_BOUNTY_METHODS.finalizePayout,
    args: [disclosureId],
    value: 0n,
  });
  return hash as `0x${string}`;
}

export async function claimPayout(
  client: GenLayerClient<GenLayerChain>,
  bountyAddress: `0x${string}`,
  disclosureId: string
): Promise<`0x${string}`> {
  const hash = await client.writeContract({
    address: bountyAddress,
    functionName: VECTOR_BOUNTY_METHODS.claimPayout,
    args: [disclosureId],
    value: 0n,
  });
  return hash as `0x${string}`;
}

export async function expireDisclosure(
  client: GenLayerClient<GenLayerChain>,
  bountyAddress: `0x${string}`,
  disclosureId: string
): Promise<`0x${string}`> {
  const hash = await client.writeContract({
    address: bountyAddress,
    functionName: VECTOR_BOUNTY_METHODS.expireDisclosure,
    args: [disclosureId],
    value: 0n,
  });
  return hash as `0x${string}`;
}

export async function expireUnclaimedPayout(
  client: GenLayerClient<GenLayerChain>,
  bountyAddress: `0x${string}`,
  disclosureId: string
): Promise<`0x${string}`> {
  const hash = await client.writeContract({
    address: bountyAddress,
    functionName: VECTOR_BOUNTY_METHODS.expireUnclaimedPayout,
    args: [disclosureId],
    value: 0n,
  });
  return hash as `0x${string}`;
}

export async function closeBounty(
  client: GenLayerClient<GenLayerChain>,
  bountyAddress: `0x${string}`
): Promise<`0x${string}`> {
  const hash = await client.writeContract({
    address: bountyAddress,
    functionName: VECTOR_BOUNTY_METHODS.closeBounty,
    args: [],
    value: 0n,
  });
  return hash as `0x${string}`;
}

export async function withdrawUnusedPool(
  client: GenLayerClient<GenLayerChain>,
  bountyAddress: `0x${string}`
): Promise<`0x${string}`> {
  const hash = await client.writeContract({
    address: bountyAddress,
    functionName: VECTOR_BOUNTY_METHODS.withdrawUnusedPool,
    args: [],
    value: 0n,
  });
  return hash as `0x${string}`;
}
