import type { Party, PartyId } from "./types";

// Fallbacks for the merged buckets (lib+nat → coa, ind_* → ind) and for
// "oth"/`onp`, which `data.parties` may or may not carry explicitly.
export const BUCKET_LABEL: Record<
  PartyId,
  { name: string; code: string; color: string }
> = {
  coa: { name: "Coalition", code: "COA", color: "#1a4d8f" },
  ind: { name: "Independents", code: "IND", color: "#3aa8b8" },
  oth: { name: "Other", code: "OTH", color: "#7a6a55" },
  alp: { name: "Labor", code: "ALP", color: "#d8232a" },
  grn: { name: "Greens", code: "GRN", color: "#3f8a3f" },
  onp: { name: "One Nation", code: "ONP", color: "#f26722" },
};

export interface ResolvedParty {
  id: PartyId;
  code: string;
  name: string;
  color: string;
}

export function resolveParty(
  id: PartyId,
  parties: Record<PartyId, Party>,
): ResolvedParty {
  const fallback = BUCKET_LABEL[id];
  const fromData = parties[id];
  return {
    id,
    code: fallback?.code ?? id.toUpperCase(),
    name: fromData?.label ?? fallback?.name ?? id,
    color: fromData?.colour ?? fallback?.color ?? "#777",
  };
}
