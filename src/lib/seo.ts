import type { Metadata } from "next";
import { getPublicEnv } from "./env";

const env = getPublicEnv();
// Define types that match Next.js metadata expectations
export interface OpenGraph {
  type?: string;
  title: string;
  description: string;
  images?: { url: string; width?: number; height?: number; alt?: string }[];
  siteName?: string;
  url?: string;
  article?: {
    publishedTime?: string;
    modifiedTime?: string;
    authors?: readonly string[];
    section?: string;
    tags?: readonly string[];
  };
}

export interface TwitterCard {
  card: string;
  title: string;
  description: string;
  images?: string[];
  creator?: string;
  site?: string;
}

/**
 * Site configuration
 * Update these values to match your brand
 */
const SITE_CONFIG = {
  name: "ElonGoat",
  title: "ElonGoat — Digital Elon (AI)",
  description:
    "A sci-fi knowledge base + streaming AI chat inspired by Elon Musk (not affiliated). Browse topic hubs and keyword pages built from real search demand.",
  url: (env.NEXT_PUBLIC_SITE_URL ?? "https://elongoat.io").replace(/\/$/, ""),
  ogImage: "/og-image.svg",
  twitterHandle: "@elongoat",
  twitterCard: "summary_large_image" as const,
  author: "ElonGoat",
  keywords: [
    "Elon Musk",
    "AI chat",
    "knowledge base",
    "ElonSim",
    "Tesla",
    "SpaceX",
    "X/Twitter",
    "tech questions",
  ] as string[],
  // SEO-optimized title templates for different page types
  titleTemplates: {
    topic: (topic: string) => `${topic} | Elon Musk Knowledge Hub`,
    page: (page: string, topic: string) => `${page} - ${topic} | ElonGoat`,
    qa: (question: string) => question.endsWith("?") ? question : `${question}?`,
    video: (title: string) => `${title} | Elon Musk Video`,
    fact: (title: string) => `${title} | Elon Musk Facts 2026`,
  },
} as const;

/**
 * Truncate text to specified length
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3).trim() + "...";
}

/**
 * SEO metadata interface
 */
export interface SeoMetadata {
  title: string;
  description: string;
  path: string;
  ogImage?: string;
  ogType?: "website" | "article" | "video.other";
  noindex?: boolean;
  nofollow?: boolean;
  keywords?: string[];
  publishedTime?: string;
  modifiedTime?: string;
  section?: string;
  tags?: string[];
}

/**
 * Generate production-grade metadata for a page
 * Follows Google SEO guidelines and best practices
 * Enhanced with Open Graph article type and rich previews
 */
export function generateMetadata(params: SeoMetadata): Metadata {
  const {
    title,
    description,
    path,
    ogImage,
    ogType = "website",
    noindex = false,
    nofollow = false,
    keywords,
    publishedTime,
    modifiedTime,
    section,
    tags,
  } = params;

  // Ensure title is within optimal length (50-60 chars)
  const seoTitle = truncate(title, 60);
  const fullTitle = `${seoTitle} — ${SITE_CONFIG.name}`;

  // Ensure description is within optimal length (150-160 chars)
  const seoDescription = truncate(description, 160);

  // Build canonical URL
  const canonicalUrl = `${SITE_CONFIG.url}${path}`;

  // Build Open Graph metadata with enhanced properties
  const openGraph: OpenGraph = {
    type: ogType,
    url: canonicalUrl,
    title: fullTitle,
    description: seoDescription,
    siteName: SITE_CONFIG.name,
    images: [
      {
        url: ogImage
          ? `${SITE_CONFIG.url}${ogImage}`
          : `${SITE_CONFIG.url}${SITE_CONFIG.ogImage}`,
        width: 1200,
        height: 630,
        alt: seoTitle,
      },
    ],
  };

  // Add article-specific OG tags with section and tags
  if (ogType === "article") {
    openGraph.article = {
      publishedTime: publishedTime,
      modifiedTime: modifiedTime ?? publishedTime,
      authors: [SITE_CONFIG.author],
      section: section,
      tags: tags ?? keywords,
    };
  }

  // Add video-specific OG tags
  if (ogType === "video.other") {
    openGraph.article = {
      publishedTime,
      modifiedTime,
      authors: [SITE_CONFIG.author],
      section: section ?? "Videos",
      tags: tags ?? keywords,
    };
  }

  // Build Twitter Card metadata with player URL for videos
  const twitter: TwitterCard = {
    card: SITE_CONFIG.twitterCard,
    title: fullTitle,
    description: seoDescription,
    images: [
      ogImage
        ? `${SITE_CONFIG.url}${ogImage}`
        : `${SITE_CONFIG.url}${SITE_CONFIG.ogImage}`,
    ],
    creator: SITE_CONFIG.twitterHandle,
    site: SITE_CONFIG.twitterHandle,
  };

  return {
    title: fullTitle,
    description: seoDescription,
    authors: [{ name: SITE_CONFIG.author }],
    keywords: keywords?.join(", "),
    robots: {
      index: !noindex,
      follow: !nofollow,
      googleBot: {
        index: !noindex,
        follow: !nofollow,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
    openGraph,
    twitter,
    alternates: {
      canonical: canonicalUrl,
      // Future-proof: add language alternatives here
      // languages: {
      //   'en': canonicalUrl,
      //   'es': `${SITE_CONFIG.url}/es${path}`,
      // },
    },
    verification: {
      // Add verification codes as needed
      // google: 'verification-code',
      // yandex: 'verification-code',
    },
    ...(keywords && {
      other: {
        "article:tag": keywords.join(","),
      },
    }),
  };
}

/**
 * Generate homepage metadata
 */
export async function generateHomeMetadata(): Promise<Metadata> {
  // Dynamically get counts from cluster index
  const getClusterIndex = (await import("./indexes")).getClusterIndex;
  let topicCount = 0;
  let pageCount = 0;
  try {
    const cluster = await getClusterIndex();
    topicCount = cluster.topics.length;
    pageCount = cluster.pages.length;
  } catch {
    // Fallback to generic description if index unavailable
  }

  const dynamicDescription =
    topicCount && pageCount
      ? `A sci-fi knowledge base + streaming AI chat inspired by Elon Musk (not affiliated). Browse ${topicCount} topic hubs and ${pageCount.toLocaleString()} keyword pages built from real search demand.`
      : SITE_CONFIG.description;

  return generateMetadata({
    title: SITE_CONFIG.title,
    description: dynamicDescription,
    path: "/",
  });
}

/**
 * Generate topic hub metadata
 * Optimized for topical authority and sitelinks
 */
export function generateTopicMetadata(params: {
  topic: string;
  topicSlug: string;
  pageCount: number;
  totalVolume?: number;
}): Metadata {
  const { topic, topicSlug, pageCount } = params;
  const currentYear = new Date().getFullYear();

  // Use SEO-optimized title template
  const title = SITE_CONFIG.titleTemplates.topic(topic);

  // Create comprehensive description highlighting content depth
  const description = `Complete ${topic} guide: ${pageCount.toLocaleString()} in-depth articles covering everything about Elon Musk and ${topic}. AI-powered insights updated ${currentYear}.`;

  return generateMetadata({
    title,
    description,
    path: `/${topicSlug}`,
    ogImage: `/og/topic/${topicSlug}`,
    keywords: [
      topic,
      "topic hub",
      "Elon Musk",
      `${topic} ${currentYear}`,
      `${topic} guide`,
      `${topic} news`,
    ],
    section: "Topics",
    publishedTime: new Date().toISOString(),
  });
}

/**
 * Generate topics index metadata
 */
export function generateTopicsIndexMetadata(params: {
  topicCount: number;
  totalPages: number;
  totalVolume?: number;
}): Metadata {
  const { topicCount, totalPages } = params;
  const title = "Topics — Browse Elon Musk Knowledge Hubs";
  const description = `Explore ${topicCount} topic hubs with ${totalPages.toLocaleString()} keyword pages about Elon Musk. Covering Tesla, SpaceX, X/Twitter, and more.`;

  return generateMetadata({
    title,
    description,
    path: "/topics",
    keywords: [
      "Elon Musk topics",
      "Tesla",
      "SpaceX",
      "topic hubs",
      "keyword research",
      "knowledge base",
    ],
    section: "Topics",
  });
}

/**
 * Generate Q&A index metadata
 */
export function generateQaIndexMetadata(params: { qaCount: number }): Metadata {
  const { qaCount } = params;
  const title = "Q&A — Elon Musk Questions and Answers";
  const description = `Get answers to ${qaCount.toLocaleString()} frequently asked questions about Elon Musk. From Google People Also Ask data with AI-generated explanations and sources.`;

  return generateMetadata({
    title,
    description,
    path: "/q",
    keywords: [
      "Elon Musk Q&A",
      "People Also Ask",
      "FAQ",
      "questions and answers",
      "Elon Musk facts",
    ],
    section: "Q&A",
  });
}

/**
 * Generate facts index metadata
 */
export function generateFactsIndexMetadata(params: {
  age: number;
  childrenCount: number;
  dob: string;
  netWorth: string;
}): Metadata {
  const { age, childrenCount, dob, netWorth } = params;
  const title = "Facts — Quick Elon Musk Information";
  const description = `Quick facts about Elon Musk: age (${age}), children (${childrenCount}), date of birth (${dob}), and net worth estimate (${netWorth}). Live variables that update automatically.`;

  return generateMetadata({
    title,
    description,
    path: "/facts",
    keywords: [
      "Elon Musk age",
      "Elon Musk net worth",
      "Elon Musk children",
      "Elon Musk date of birth",
      "quick facts",
    ],
    section: "Facts",
  });
}

/**
 * Generate videos index metadata
 */
export function generateVideosIndexMetadata(params: {
  hasVideos: boolean;
}): Metadata {
  const { hasVideos } = params;
  const title = "Videos — Elon Musk Video Index";
  const description = hasVideos
    ? `Browse Elon Musk related videos from Google Videos search results. Includes video details, transcripts, and AI chat integration for video content.`
    : `Elon Musk video index. Videos are ingested via Google Videos search (SOAX) with optional YouTube transcripts.`;

  return generateMetadata({
    title,
    description,
    path: "/videos",
    keywords: [
      "Elon Musk videos",
      "YouTube",
      "video transcripts",
      "Tesla videos",
      "SpaceX videos",
    ],
    section: "Videos",
  });
}

/**
 * Generate keyword page metadata
 * Optimized for search intent and click-through rate
 */
export function generateClusterPageMetadata(params: {
  page: string;
  topic: string;
  maxVolume?: number;
  keywordCount: number;
  topicSlug: string;
  pageSlug: string;
}): Metadata {
  const { page, topic, keywordCount, topicSlug, pageSlug } = params;

  // Use SEO-optimized title template
  const title = SITE_CONFIG.titleTemplates.page(page, topic);

  // Create compelling meta description with search intent signals
  const currentYear = new Date().getFullYear();
  const description = `${page} explained: comprehensive guide covering ${keywordCount.toLocaleString()} related topics. Updated ${currentYear}. Get AI-powered insights about ${topic} with verified sources.`;

  return generateMetadata({
    title,
    description,
    path: `/${topicSlug}/${pageSlug}`,
    ogType: "article",
    keywords: [page, topic, "Elon Musk", `${page} ${currentYear}`, `${topic} guide`],
    section: topic,
    tags: [page, topic, "knowledge base", "AI analysis"],
    publishedTime: new Date().toISOString(),
    modifiedTime: new Date().toISOString(),
  });
}

/**
 * Generate Q&A page metadata
 * Optimized for featured snippets and FAQ rich results
 */
export function generateQaMetadata(params: {
  question: string;
  answer?: string | null;
  slug: string;
  volume?: number;
}): Metadata {
  const { question, answer, slug } = params;

  // Ensure question ends with question mark for better CTR
  const title = SITE_CONFIG.titleTemplates.qa(question);

  // Create answer-focused description for featured snippet optimization
  const currentYear = new Date().getFullYear();
  const answerPreview = answer?.slice(0, 120)?.replace(/\n/g, " ") ?? "";
  const description = answerPreview
    ? `${answerPreview}... Get the complete answer with AI-verified sources (${currentYear}).`
    : `Get the definitive answer to "${question}" with AI-generated explanations, verification notes, and related questions.`;

  return generateMetadata({
    title,
    description,
    path: `/q/${slug}`,
    ogType: "article",
    keywords: [
      question.replace(/\?/g, ""),
      "Q&A",
      "Elon Musk",
      "answer",
      "FAQ",
      `${question.split(" ").slice(0, 3).join(" ")} ${currentYear}`,
    ],
    section: "Q&A",
    tags: ["Q&A", "question", "answer", "FAQ", "Elon Musk"],
    publishedTime: new Date().toISOString(),
  });
}

/**
 * Generate video page metadata
 */
export function generateVideoMetadata(params: {
  title: string;
  videoId: string;
  channel?: string | null;
  duration?: string | null;
  publishedAt?: string | null;
  description?: string | null;
}): Metadata {
  const { title, videoId, channel, duration, description } = params;
  const fullTitle = title ?? `Video ${videoId}`;
  const videoDescription =
    description ??
    `Watch "${fullTitle}"${channel ? ` from ${channel}` : ""}. ${duration ? `Duration: ${duration}.` : ""} Video details and transcript for AI chat grounding.`;

  return generateMetadata({
    title: fullTitle,
    description: videoDescription,
    path: `/videos/${videoId}`,
    ogImage: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    ogType: "video.other",
    keywords: [
      fullTitle,
      "video",
      "Elon Musk",
      "YouTube",
      channel ?? "",
    ].filter(Boolean),
    section: "Videos",
    tags: ["video", "Elon Musk", channel ?? "YouTube"],
  });
}

/**
 * Generate facts page metadata
 */
export function generateFactMetadata(params: {
  title: string;
  value: string;
  description: string;
  fact: string;
}): Metadata {
  const { title, value, description, fact } = params;
  const fullTitle = title;
  const fullDescription = `${description} Current value: ${value}. Quick facts about Elon Musk with live variables and AI chat.`;

  return generateMetadata({
    title: fullTitle,
    description: fullDescription,
    path: `/facts/${fact}`,
    keywords: [title, "fact", "Elon Musk", "quick info"],
    section: "Facts",
    tags: ["fact", "quick info", "Elon Musk"],
  });
}

/**
 * Generate error page metadata (noindex)
 */
export function generateErrorMetadata(title: string): Metadata {
  return {
    title: `${title} — ${SITE_CONFIG.name}`,
    robots: {
      index: false,
      follow: false,
    },
  };
}

/**
 * Get site config for use in components
 */
export function getSiteConfig() {
  return SITE_CONFIG;
}

/**
 * Generate JSON-LD script tag content for use in pages
 */
export interface JsonLdProps {
  type: string;
  data: Record<string, unknown>;
}

/**
 * Create a JSON-LD script element
 */
export function createJsonLdScript(props: JsonLdProps): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": props.type,
    ...props.data,
  });
}
