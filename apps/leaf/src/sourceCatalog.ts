/** Availability describes implemented acquisition, never a presumed account connection. */
export const sourceCatalog = [
  { id: "open-design", name: "Open Design", group: "Design", detail: "Choose projects and design files on this device.", mode: "projects" },
  { id: "figma", name: "Figma", group: "Design", detail: "Design decisions, prototypes and product work.", mode: "export" },
  { id: "design-image", name: "Design image", group: "Design", detail: "Choose a local PNG or JPEG export; attach a Dribbble shot link.", mode: "image" },
  { id: "claude-design", name: "Claude Design", group: "Design", detail: "Design explorations and the artifacts you created.", mode: "export" },
  { id: "repository", name: "Git repositories", group: "Build", detail: "Collect changes from the repositories you choose.", mode: "repository" },
  { id: "personal-project", name: "Personal project", group: "Create", detail: "Select several files from one project on this device.", mode: "bundle" },
  { id: "documents", name: "Documents & presentations", group: "Write", detail: "Specs, research, decisions and written outcomes.", mode: "export" },
  { id: "assistant", name: "AI-assisted work", group: "Build", detail: "Selected work from Claude, ChatGPT, Codex and other assistants.", mode: "export" },
  { id: "other", name: "Other work", group: "Discover", detail: "Bring evidence from tools that are not listed yet.", mode: "export" },
] as const;
export type SourceProvider = typeof sourceCatalog[number]["id"];
export interface SourcePreview {
  id: string; provider: string; title: string; excerpt: string; truncated: boolean; bytes: number;
}
export interface SourceBundlePreview {
  id: string; provider: "personal-project"; title: string; bytes: number;
  files: readonly { name: string; text: string; bytes: number; state: "new" | "revised" | "already" }[];
}
export interface SourceImagePreview {
  id: string; provider: "design-image"; title: string; project: string; name: string;
  bytes: number; imageUrl: string; origin: "figma-export" | "local-image"; referenceUrl: string | null;
}
export interface SourceItem { id: string; name: string }
export interface CompanionStatus {
  connected: boolean; ready: boolean; model: string | null; detail: string;
}
