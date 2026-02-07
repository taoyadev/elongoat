import { NextResponse } from "next/server";
import { getPublicEnv } from "../../lib/env";

const env = getPublicEnv();

/**
 * Sitemap Index - References all sub-sitemaps
 * Google recommends sitemap indexes for sites with >50k URLs
 */
export async function GET() {
  const siteUrl = (env.NEXT_PUBLIC_SITE_URL ?? "https://elongoat.io").replace(
    /\/$/,
    "",
  );
  const now = new Date().toISOString();

  const sitemaps = [
    { loc: `${siteUrl}/sitemap.xml`, priority: "high" },
    { loc: `${siteUrl}/sitemaps/topics/sitemap.xml`, priority: "high" },
    { loc: `${siteUrl}/sitemaps/qa/sitemap.xml`, priority: "high" },
    { loc: `${siteUrl}/sitemaps/tweets/sitemap.xml`, priority: "medium" },
    { loc: `${siteUrl}/sitemaps/videos/sitemap.xml`, priority: "medium" },
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps
  .map(
    (s) => `  <sitemap>
    <loc>${s.loc}</loc>
    <lastmod>${now}</lastmod>
  </sitemap>`,
  )
  .join("\n")}
</sitemapindex>`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
