import type { MetadataRoute } from "next";
import { siteConfig } from "@/src/siteConfig";
export default function sitemap(): MetadataRoute.Sitemap {
 const { site } = siteConfig(process.env);
 return site ? ["", "/photosynthesis", "/canopy", "/why-foliage", "/start", "/privacy"].map(path => ({ url: `${site}${path}` })) : [];
}
