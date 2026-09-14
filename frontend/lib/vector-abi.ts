export const VECTOR_FACTORY_METHODS = {
  registerBounty: "register_bounty",
  getBountyCode: "get_bounty_code",
  withdrawFees: "withdraw_fees",
  getOwner: "get_owner",
  getCreationStake: "get_creation_stake",
  getCollectedFees: "get_collected_fees",
  getBounties: "get_bounties",
  getBountiesCount: "get_bounties_count",
  getBountiesPage: "get_bounties_page",
  getBountyMeta: "get_bounty_meta",
  getBountiesBySponsor: "get_bounties_by_sponsor",
} as const;

export const VECTOR_BOUNTY_METHODS = {
  fundPool: "fund_pool",
  submitDisclosure: "submit_disclosure",
  triage: "triage",
  challengeDuplicate: "challenge_duplicate",
  resolveDuplicate: "resolve_duplicate",
  finalizePayout: "finalize_payout",
  claimPayout: "claim_payout",
  expireDisclosure: "expire_disclosure",
  expireUnclaimedPayout: "expire_unclaimed_payout",
  closeBounty: "close_bounty",
  withdrawUnusedPool: "withdraw_unused_pool",
  getBountyInfo: "get_bounty_info",
  getDisclosure: "get_disclosure",
  getDisclosures: "get_disclosures",
  getDisclosuresByStatus: "get_disclosures_by_status",
  getDisclosuresByResearcher: "get_disclosures_by_researcher",
  getClaimable: "get_claimable",
  isClaimed: "is_claimed",
} as const;

export const SEVERITY_LEVELS = ["critical", "high", "medium", "low"] as const;
export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];

export const DISCLOSURE_STATUSES = [
  "PENDING",
  "TRIAGING",
  "UNVERIFIABLE",
  "REJECTED",
  "VERIFIED",
  "DUPLICATE",
  "PAYOUT_PENDING",
  "PAID",
  "EXPIRED",
] as const;
export type DisclosureStatus = (typeof DISCLOSURE_STATUSES)[number];

export const TERMINAL_DISCLOSURE_STATUSES: DisclosureStatus[] = [
  "PAID",
  "REJECTED",
  "DUPLICATE",
  "EXPIRED",
  "UNVERIFIABLE",
];

// Mirrors DUPLICATE_CHALLENGE_WINDOW_SECONDS / DISCLOSURE_EXPIRE_TIMEOUT_SECONDS
// / TRIAGE_UNVERIFIABLE_AFTER_SECONDS in contracts/VectorBounty.py -- used to
// explain timing in the UI, never to gate an on-chain action client-side.
export const DUPLICATE_CHALLENGE_WINDOW_SECONDS = 172800;
export const DISCLOSURE_EXPIRE_TIMEOUT_SECONDS = 604800;
export const TRIAGE_UNVERIFIABLE_AFTER_SECONDS = 86400;
export const PAYOUT_CLAIM_TIMEOUT_SECONDS = 2592000;

export interface SeverityPayouts {
  critical: string;
  high: string;
  medium: string;
  low: string;
}

export interface BountyMeta {
  address: string;
  title: string;
  description: string;
  target_url: string;
  sponsor: string;
  severity_payouts: SeverityPayouts;
  disclosure_bond: string;
  created_at: string;
  creation_stake_paid: string;
}

export interface BountyInfo {
  address_factory: string;
  sponsor: string;
  title: string;
  description: string;
  target_url: string;
  created_at: string;
  status: "open" | "closed";
  severity_payouts: SeverityPayouts;
  disclosure_bond: string;
  pool_remaining: string;
  reserved_wei: string;
  available_wei: string;
  disclosure_count: number;
}

export interface DisclosureRecord {
  id: string;
  researcher: string;
  title: string;
  description: string;
  repro_steps: string;
  target_ref: string;
  claimed_severity: SeverityLevel;
  status: DisclosureStatus;
  assigned_severity: SeverityLevel | "";
  payout_wei: string;
  evidence_snapshot: string;
  reasoning: string;
  confidence: string;
  fetch_attempts: number;
  submitted_at: string;
  triaged_at: string;
  duplicate_of: string;
  challenge_window_ends_at: string;
  expire_after: string;
  bond_wei: string;
  payout_pending_at: string;
  reserved_wei: string;
}

export function severityLabel(severity: string): string {
  if (!severity) return "—";
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

// Dot-density weight per severity, most-to-least: used to render a
// dot-meter instead of the red/orange/green traffic-light cliché.
export const SEVERITY_WEIGHT: Record<SeverityLevel, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function statusLabel(status: string): string {
  switch (status) {
    case "PENDING":
      return "Pending triage";
    case "TRIAGING":
      return "Triaging";
    case "UNVERIFIABLE":
      return "Unverifiable";
    case "REJECTED":
      return "Rejected";
    case "VERIFIED":
      return "Verified";
    case "DUPLICATE":
      return "Duplicate";
    case "PAYOUT_PENDING":
      return "Payout pending";
    case "PAID":
      return "Paid";
    case "EXPIRED":
      return "Expired";
    default:
      return status;
  }
}
