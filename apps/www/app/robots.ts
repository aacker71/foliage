import type { MetadataRoute } from "next";
import { siteConfig } from "@/src/siteConfig";
export default function robots(): MetadataRoute.Robots {
 const { site } = siteConfig(process.env);
 return { rules: { userAgent: "*", ...(site ? { allow: "/", disallow: "/prototypes/" } : { disallow: "/" }) }, ...(site ? { sitemap: `${site}/sitemap.xml` } : {}) };
}
