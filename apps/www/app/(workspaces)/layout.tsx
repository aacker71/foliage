import type { ReactNode } from "react";
import { icons } from "@/lib/metadata";
import "../globals.css";

export const metadata = { icons, robots: { index: false, follow: false } };

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <html lang="en" data-face="night"><body>{children}</body></html>;
}
