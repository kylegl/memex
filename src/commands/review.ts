import { OrganizationStore, type OrganizationProposal, type ProposalStatus } from "../core/organization.js";

export interface ReviewOptions {
  memexHome: string;
  action?: "list" | "approve" | "reject";
  proposalId?: string;
  status?: ProposalStatus;
}

export interface ReviewResult {
  success: boolean;
  output: string;
}

export async function reviewCommand(options: ReviewOptions): Promise<ReviewResult> {
  const store = new OrganizationStore(options.memexHome);
  const action = options.action ?? "list";

  if (action === "list") {
    const proposals = await store.listProposals();
    const filtered = options.status ? proposals.filter((proposal) => proposal.status === options.status) : proposals;
    if (filtered.length === 0) {
      return { success: true, output: "No organization proposals found." };
    }

    return {
      success: true,
      output: formatProposalList(filtered),
    };
  }

  if (!options.proposalId) {
    return { success: false, output: "Missing proposal id. Usage: memex review --approve <proposal-id> or --reject <proposal-id>" };
  }

  const nextStatus: ProposalStatus = action === "approve" ? "approved" : "rejected";
  const updated = await store.updateProposalStatus(options.proposalId, nextStatus);
  if (!updated) {
    return { success: false, output: `Proposal not found: ${options.proposalId}` };
  }

  return {
    success: true,
    output: `Proposal ${updated.id} -> ${updated.status}`,
  };
}

function formatProposalList(proposals: OrganizationProposal[]): string {
  const lines: string[] = ["Organization proposals:"];
  for (const proposal of proposals.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    lines.push(
      `- ${proposal.id} [${proposal.status}] ${proposal.kind} ${proposal.targetPath} confidence=${proposal.confidence.toFixed(2)}`,
    );
  }
  return lines.join("\n");
}
