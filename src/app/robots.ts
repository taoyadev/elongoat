import type { MetadataRoute } from "next";
import { getPublicEnv } from "../lib/env";

const env = getPublicEnv();
export default function robots(): MetadataRoute.Robots {
  const siteUrl = env.NEXT_PUBLIC_SITE_URL ?? "https://elongoat.io";
  const baseUrl = siteUrl.replace(/\/$/, "");

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api/", "/_next/", "/static/"],
        // No global crawlDelay - let major search engines crawl at their own pace
      },
      // Block aggressive AI scrapers (content protection)
      {
        userAgent: "GPTBot",
        disallow: ["/"],
        crawlDelay: 10,
      },
      {
        userAgent: "ChatGPT-User",
        disallow: ["/"],
        crawlDelay: 10,
      },
      {
        userAgent: "CCBot",
        disallow: ["/"],
        crawlDelay: 10,
      },
      {
        userAgent: "anthropic-ai",
        disallow: ["/"],
        crawlDelay: 10,
      },
      {
        userAgent: "Claude-Web",
        disallow: ["/"],
        crawlDelay: 10,
      },
      {
        userAgent: "Claude-Search",
        disallow: ["/"],
        crawlDelay: 10,
      },
      {
        userAgent: "PerplexityBot",
        disallow: ["/"],
        crawlDelay: 10,
      },
      // Google-specific directives (no crawlDelay for Googlebot)
      {
        userAgent: "Googlebot",
        allow: "/",
        disallow: ["/admin", "/api/"],
      },
      {
        userAgent: "Google-Extended",
        disallow: ["/"],
      },
      // Bingbot - no crawlDelay needed
      {
        userAgent: "Bingbot",
        allow: "/",
        disallow: ["/admin", "/api/"],
      },
      // Other aggressive crawlers get throttled
      {
        userAgent: ["SemrushBot", "AhrefsBot", "DotBot", "MJ12bot"],
        crawlDelay: 5,
      },
    ],
    sitemap: [
      `${baseUrl}/sitemap.xml`,
      `${baseUrl}/sitemaps/topics/sitemap.xml`,
      `${baseUrl}/sitemaps/qa/sitemap.xml`,
      `${baseUrl}/sitemaps/tweets/sitemap.xml`,
      `${baseUrl}/sitemaps/videos/sitemap.xml`,
    ],
    host: baseUrl,
  };
}
