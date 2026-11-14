import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { surfaces, type Surface } from "@/components/prototypes/catalog";
import { Workspace } from "@/components/prototypes/workspace";

export function generateStaticParams() { return Object.keys(surfaces).map(surface => ({ surface })); }
export async function generateMetadata({ params }: { params: Promise<{ surface: string }> }): Promise<Metadata> {
  const { surface } = await params;
  if (!Object.hasOwn(surfaces, surface)) return {};
  const app = surfaces[surface as Surface];
  return { title: `${app.name} preview | Foliage`, robots: { index: false, follow: false } };
}
export default async function Prototype({ params }: { params: Promise<{ surface: string }> }) {
  const { surface } = await params;
  if (!Object.hasOwn(surfaces, surface)) notFound();
  return <Workspace surface={surface as Surface} />;
}
