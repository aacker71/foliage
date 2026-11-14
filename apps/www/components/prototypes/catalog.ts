export const surfaces = {
  individual: {
    audience: "personal", name: "Individual", title: "Your Leaf", eyebrow: "Personal workspace",
    description: "Turn the work you already do into memories, then choose who sees them.",
    sections: ["My Leaf", "Review", "Sources"],
    emptyTitle: "Your Leaf starts with your work",
    emptyBody: "No work connected.",
    next: "Preview a file", nextSection: "Sources",
    detailTitle: "You decide what leaves this workspace",
    detailBody: "Review, attribution and sharing are separate decisions. Adding a source does not publish it.",
  },
  recruiter: {
    audience: "business", name: "Recruiter", title: "Shared portfolios", eyebrow: "Invited reader",
    description: "Open a portfolio someone chose to share with you. Understand their contribution through the work itself.",
    sections: ["Shared portfolios", "Open a link", "Reading guide"],
    emptyTitle: "Nothing has been shared in this prototype",
    emptyBody: "Start with a portfolio link from its owner. There is no directory of people or ranking to browse.",
    next: "Open a shared link", nextSection: "Open a link",
    detailTitle: "Evidence, without a ranking",
    detailBody: "Verified, pending and excluded describe attribution. They are not a measure of a person's value.",
  },
  organization: {
    audience: "business", name: "Organization", title: "Company workspace", eyebrow: "Company workspace",
    description: "See declared company structure and keep release decisions attached to the work they govern.",
    sections: ["Structure", "Releases", "Members"],
    emptyTitle: "Your company structure belongs here",
    emptyBody: "No company or membership is connected. Structure must come from declared relationships, not inferred titles.",
    next: "Review release flow", nextSection: "Releases",
    detailTitle: "Tree → Bough → Branch → Leaf",
    detailBody: "A Tree is a company. A Bough is an organization. A Branch is a team. A Leaf belongs to a person.",
  },
  member: {
    audience: "business", name: "Member",
    description: "Keep your own account of the work you contributed, with company release decisions kept separate.",
  },
} as const;
export type Surface = keyof typeof surfaces;
export type Audience = (typeof surfaces)[Surface]["audience"];
export const audienceOf = (surface: Surface): Audience => surfaces[surface].audience;
