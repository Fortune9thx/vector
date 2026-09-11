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

export async function createBounty(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`,
  title: string,
  description: string,
  targetUrl: string,
  severityCriticalWei: string,
  severityHighWei: string,
  severityMediumWei: string,
  severityLowWei: string,
  disclosureBondWei: string,
  value: bigint
): Promise<`0x${string}`> {
  const hash = await client.writeContract({
    address: factoryAddress,
    functionName: VECTOR_FACTORY_METHODS.createBounty,
    args: [
      title,
      description,
      targetUrl,
      severityCriticalWei,
      severityHighWei,
      severityMediumWei,
      severityLowWei,
      disclosureBondWei,
    ],
    value,
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

/**
 * create_bounty's write-transaction result exposes ACCEPTED/FINALIZED
 * status, not a decoded method return value in a stable, documented shape --
 * so rather than depend on undocumented transaction-result decoding,
 * resolve the newly-deployed bounty address the reliable way: `bounties` is
 * an append-only registry, so the new bounty is whatever appears at index
 * `beforeCount` once the list grows past it. Retries with a short delay to
 * absorb the same post-ACCEPTED read lag documented for fresh contract
 * state elsewhere in this stack -- a gl.contract.deploy-triggered child
 * contract can take dramatically longer to become independently readable
 * than a top-level deploy.
 */
export async function waitForNewBounty(
  client: GenLayerClient<GenLayerChain>,
  factoryAddress: `0x${string}`,
  beforeCount: number,
  { retries = 15, intervalMs = 3000 }: { retries?: number; intervalMs?: number } = {}
): Promise<string> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const bounties = await fetchBounties(client, factoryAddress);
    if (bounties.length > beforeCount) return bounties[beforeCount];
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for the new bounty to appear in the registry.");
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
