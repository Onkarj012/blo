import {
  buildDisplayAddress,
  cleanText,
  detectAreaCluster,
  detectAreaClusterAmbiguity,
  determineAddressQuality,
  findKnownClusterMatch,
  isLowInformationAddress,
} from "@/lib/normalize";

export type ClusterAuditInputRow = {
  name?: string;
  phone_number?: string;
  address?: string;
  age?: string;
  gender?: string;
  relative_name?: string;
  relative_type?: string;
  epic_number?: string;
  ecinet_name?: string;
  ecinet_relative_name?: string;
  ecinet_part_sr_no?: string;
  merge_match_confidence?: string;
  merge_notes?: string;
};

export type ClusterReviewStatus = "ready" | "review" | "manual_lookup";

export type ClusterAuditRow = {
  sequence: string;
  route_cluster: string;
  cluster_size: string;
  cluster_review_status: ClusterReviewStatus;
  cluster_confidence: string;
  cluster_reason: string;
  cluster_notes: string;
  display_address: string;
  address_quality: "actionable" | "vague" | "missing";
  name: string;
  epic_number: string;
  phone_number: string;
  address: string;
  age: string;
  gender: string;
  relative_name: string;
  relative_type: string;
  ecinet_name: string;
  ecinet_relative_name: string;
  ecinet_part_sr_no: string;
  identity_match_confidence: string;
  merge_notes: string;
};

const KNOWN_CLUSTER_CONFIDENCE = 0.96;
const EXPLICIT_CLUSTER_CONFIDENCE = 0.82;
const AMBIGUOUS_CLUSTER_CONFIDENCE = 0.58;
const LOW_INFORMATION_CONFIDENCE = 0.12;

function asFixedConfidence(value: number): string {
  return value.toFixed(2);
}

function isWeakAddressToken(address: string): boolean {
  const cleaned = cleanText(address);
  return /^[a-z]?\d+[a-z]?(?:\s*,?\s*[a-z]?\d+[a-z]?)*$/i.test(cleaned);
}

function reviewStatusFor(input: {
  addressQuality: "actionable" | "vague" | "missing";
  lowInformation: boolean;
  ambiguous: boolean;
  identityConfidence: string;
}): ClusterReviewStatus {
  if (input.addressQuality === "missing" || input.lowInformation) {
    return "manual_lookup";
  }
  if (input.addressQuality === "vague" || input.ambiguous || input.identityConfidence === "unmatched") {
    return "review";
  }
  return "ready";
}

function buildClusterNotes(input: {
  knownCluster: boolean;
  lowInformation: boolean;
  weakAddressToken: boolean;
  ambiguous: boolean;
  ambiguityReason?: string;
  identityConfidence: string;
}): string {
  const notes: string[] = [];
  if (input.knownCluster) notes.push("known_cluster_match");
  if (input.lowInformation) notes.push("low_information_address");
  if (input.weakAddressToken) notes.push("unit_or_number_only_address");
  if (input.ambiguous) notes.push(input.ambiguityReason || "ambiguous_cluster");
  if (input.identityConfidence === "unmatched") notes.push("identity_unmatched_in_ecinet");
  return notes.join(";");
}

export function buildClusterAuditRows(rows: ClusterAuditInputRow[]): ClusterAuditRow[] {
  const draftRows = rows.map((row, index) => {
    const address = cleanText(row.address);
    const displayAddress = buildDisplayAddress(address);
    const routeCluster = detectAreaCluster(address);
    const addressQuality = determineAddressQuality(address, routeCluster);
    const knownCluster = findKnownClusterMatch(address) === routeCluster;
    const lowInformation = isLowInformationAddress(address);
    const weakAddressToken = isWeakAddressToken(address);
    const ambiguity = detectAreaClusterAmbiguity({
      addressRaw: address,
      displayAddress,
      detectedCluster: routeCluster,
    });
    const clusterReviewStatus = reviewStatusFor({
      addressQuality,
      lowInformation,
      ambiguous: ambiguity.shouldUseLlm,
      identityConfidence: cleanText(row.merge_match_confidence),
    });
    const clusterConfidence = lowInformation
      ? LOW_INFORMATION_CONFIDENCE
      : ambiguity.shouldUseLlm
        ? AMBIGUOUS_CLUSTER_CONFIDENCE
        : knownCluster
          ? KNOWN_CLUSTER_CONFIDENCE
          : EXPLICIT_CLUSTER_CONFIDENCE;
    const clusterReason = lowInformation
      ? "low_information_address"
      : ambiguity.reasonCode || (knownCluster ? "known_cluster_match" : "explicit_address_phrase");

    return {
      sequence: String(index + 1),
      route_cluster: routeCluster,
      cluster_size: "0",
      cluster_review_status: clusterReviewStatus,
      cluster_confidence: asFixedConfidence(clusterConfidence),
      cluster_reason: clusterReason,
      cluster_notes: buildClusterNotes({
        knownCluster,
        lowInformation,
        weakAddressToken,
        ambiguous: ambiguity.shouldUseLlm,
        ambiguityReason: ambiguity.reasonCode,
        identityConfidence: cleanText(row.merge_match_confidence),
      }),
      display_address: displayAddress,
      address_quality: addressQuality,
      name: cleanText(row.name),
      epic_number: cleanText(row.epic_number),
      phone_number: cleanText(row.phone_number),
      address,
      age: cleanText(row.age),
      gender: cleanText(row.gender),
      relative_name: cleanText(row.relative_name),
      relative_type: cleanText(row.relative_type),
      ecinet_name: cleanText(row.ecinet_name),
      ecinet_relative_name: cleanText(row.ecinet_relative_name),
      ecinet_part_sr_no: cleanText(row.ecinet_part_sr_no),
      identity_match_confidence: cleanText(row.merge_match_confidence),
      merge_notes: cleanText(row.merge_notes),
    };
  });

  const clusterSizes = new Map<string, number>();
  for (const row of draftRows) {
    clusterSizes.set(row.route_cluster, (clusterSizes.get(row.route_cluster) ?? 0) + 1);
  }

  return draftRows
    .map((row) => ({
      ...row,
      cluster_size: String(clusterSizes.get(row.route_cluster) ?? 1),
    }))
    .sort((left, right) => {
      const clusterCompare = left.route_cluster.localeCompare(right.route_cluster);
      if (clusterCompare !== 0) return clusterCompare;
      return Number(left.sequence) - Number(right.sequence);
    });
}

export const CLUSTER_AUDIT_COLUMNS = [
  "sequence",
  "route_cluster",
  "cluster_size",
  "cluster_review_status",
  "cluster_confidence",
  "cluster_reason",
  "cluster_notes",
  "display_address",
  "address_quality",
  "name",
  "epic_number",
  "phone_number",
  "address",
  "age",
  "gender",
  "relative_name",
  "relative_type",
  "ecinet_name",
  "ecinet_relative_name",
  "ecinet_part_sr_no",
  "identity_match_confidence",
  "merge_notes",
] as const;
