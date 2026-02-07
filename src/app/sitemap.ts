import type { MetadataRoute } from "next";

import { getClusterIndex, getPaaIndex } from "../lib/indexes";
import { getPublicEnv } from "../lib/env";

const env = getPublicEnv();
export const revalidate = 3600;

// Fact pages that always exist
const FACT_SLUGS = ["age", "children", "dob", "net-worth"] as const;

// Core pages with high SEO priority
const CORE_PAGES = [
  { path: "/", priority: 1.0, changeFrequency: "daily" as const },
  { path: "/topics", priority: 0.95, changeFrequency: "daily" as const },
  { path: "/q", priority: 0.95, changeFrequency: "daily" as const },
  { path: "/writing", priority: 0.85, changeFrequency: "weekly" as const },
  { path: "/tweets", priority: 0.85, changeFrequency: "daily" as const },
  { path: "/x/archive", priority: 0.75, changeFrequency: "weekly" as const },
  { path: "/x/popular", priority: 0.78, changeFrequency: "weekly" as const },
  { path: "/videos", priority: 0.80, changeFrequency: "daily" as const },
  { path: "/about", priority: 0.70, changeFrequency: "monthly" as const },
  { path: "/facts", priority: 0.80, changeFrequency: "weekly" as const },
  { path: "/discover", priority: 0.75, changeFrequency: "weekly" as const },
  { path: "/search", priority: 0.60, changeFrequency: "monthly" as const },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = (env.NEXT_PUBLIC_SITE_URL ?? "https://elongoat.io").replace(
    /\/$/,
    "",
  );
  const [cluster, paa] = await Promise.all([getClusterIndex(), getPaaIndex()]);

  const clusterUpdated = new Date(cluster.generatedAt);
  const paaUpdated = new Date(paa.generatedAt);
  const now = new Date();

  const items: MetadataRoute.Sitemap = [];

  // Core pages with optimized priorities
  for (const page of CORE_PAGES) {
    const lastModified =
      page.path === "/" || page.path === "/topics"
        ? clusterUpdated
        : page.path === "/q"
          ? paaUpdated
          : now;

    items.push({
      url: `${siteUrl}${page.path}`,
      lastModified,
      priority: page.priority,
      changeFrequency: page.changeFrequency,
    });
  }

  // Fact pages with dynamic priorities based on search demand
  const factPriorities: Record<(typeof FACT_SLUGS)[number], number> = {
    age: 0.82,
    children: 0.78,
    "net-worth": 0.85,
    dob: 0.65,
  };

  for (const slug of FACT_SLUGS) {
    items.push({
      url: `${siteUrl}/facts/${slug}`,
      lastModified: now,
      priority: factPriorities[slug],
      changeFrequency: "weekly",
    });
  }

  // Detail-heavy sitemaps are split into dedicated routes under /sitemaps/*

  return items;
}
