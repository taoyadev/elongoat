import { getSiteConfig } from "./seo";

const SITE_URL = getSiteConfig().url;

/**
 * Base JSON-LD context
 */
const BASE_CONTEXT = "https://schema.org";

/**
 * Current year for freshness signals
 */
const CURRENT_YEAR = new Date().getFullYear();

/**
 * Generate WebSite schema with enhanced SearchAction
 * Describes the overall website with sitelinks search box potential
 */
export function generateWebSiteSchema() {
  return {
    "@context": BASE_CONTEXT,
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: SITE_URL,
    name: getSiteConfig().name,
    description: getSiteConfig().description,
    inLanguage: "en-US",
    publisher: {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: getSiteConfig().name,
      url: SITE_URL,
    },
    potentialAction: [
      {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
        },
        "query-input": {
          "@type": "PropertyValueSpecification",
          valueRequired: true,
          valueName: "search_term_string",
        },
      },
      {
        "@type": "ReadAction",
        target: `${SITE_URL}/topics`,
      },
    ],
    copyrightYear: CURRENT_YEAR,
    dateModified: new Date().toISOString(),
  };
}

/**
 * Generate Organization schema with full social links
 */
export function generateOrganizationSchema() {
  const socialUrls = [
    "https://twitter.com/elongoat",
    "https://x.com/elongoat",
    "https://github.com/elongoat",
  ];

  return {
    "@context": BASE_CONTEXT,
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: getSiteConfig().name,
    url: SITE_URL,
    description: getSiteConfig().description,
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/og-image.svg`,
      width: 1200,
      height: 630,
      caption: getSiteConfig().name,
    },
    sameAs: socialUrls,
    foundingDate: "2024",
    areaServed: "Worldwide",
    knowsAbout: [
      "Elon Musk",
      "Tesla",
      "SpaceX",
      "X/Twitter",
      "Artificial Intelligence",
      "Knowledge Base",
    ],
  };
}

/**
 * Generate BreadcrumbList schema
 * Helps search engines understand page hierarchy
 */
export interface BreadcrumbItem {
  name: string;
  url?: string;
}

export function generateBreadcrumbSchema(items: BreadcrumbItem[]) {
  const itemList = items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.name,
    ...(item.url && { item: item.url }),
  }));

  return {
    "@context": BASE_CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: itemList,
  };
}

/**
 * Generate Article schema for content pages
 */
export function generateArticleSchema(params: {
  title: string;
  description: string;
  url: string;
  publishedAt?: string;
  updatedAt?: string;
  authorName?: string;
  imageUrl?: string;
  section?: string;
  keywords?: string[];
}) {
  const {
    title,
    description,
    url,
    publishedAt,
    updatedAt,
    authorName = getSiteConfig().author,
    imageUrl,
    section,
    keywords,
  } = params;

  const article: Record<string, unknown> = {
    "@context": BASE_CONTEXT,
    "@type": "Article",
    "@id": `${SITE_URL}${url}#article`,
    headline: title,
    description: description.slice(0, 160),
    url: `${SITE_URL}${url}`,
    inLanguage: "en-US",
    isPartOf: {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
    },
    publisher: {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: getSiteConfig().name,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/logo.svg`,
      },
    },
    author: {
      "@type": "Person",
      name: authorName,
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${SITE_URL}${url}`,
    },
  };

  if (publishedAt) {
    article.datePublished = publishedAt;
  }

  if (updatedAt) {
    article.dateModified = updatedAt;
  } else if (publishedAt) {
    article.dateModified = publishedAt;
  }

  if (imageUrl) {
    article.image = {
      "@type": "ImageObject",
      url: imageUrl,
      width: 1200,
      height: 630,
    };
  }

  if (section) {
    article.articleSection = section;
  }

  if (keywords && keywords.length > 0) {
    article.keywords = keywords.join(", ");
  }

  return article;
}

/**
 * Generate FAQPage schema for Q&A pages
 * Helps content appear in FAQ rich results
 */
export interface FaqItem {
  question: string;
  answer: string;
  author?: string;
  dateCreated?: string;
  dateModified?: string;
}

export function generateFaqPageSchema(items: FaqItem[]) {
  const mainEntity = items.map((item) => ({
    "@type": "Question",
    name: item.question,
    ...(item.author && {
      author: {
        "@type": "Organization",
        name: item.author,
      },
    }),
    ...(item.dateCreated && {
      dateCreated: item.dateCreated,
    }),
    ...(item.dateModified && {
      dateModified: item.dateModified,
    }),
    acceptedAnswer: {
      "@type": "Answer",
      text: item.answer.slice(0, 500), // Limit for schema
      ...(item.author && {
        author: {
          "@type": "Organization",
          name: item.author,
        },
      }),
    },
  }));

  return {
    "@context": BASE_CONTEXT,
    "@type": "FAQPage",
    mainEntity,
  };
}

/**
 * Generate QAPage schema (newer, more detailed than FAQPage)
 */
export function generateQaPageSchema(params: {
  question: string;
  answer: string;
  url: string;
  upvoteCount?: number;
  author?: string;
  createdAt?: string;
}) {
  const { question, answer, url, upvoteCount, author, createdAt } = params;

  const qaPage: Record<string, unknown> = {
    "@context": BASE_CONTEXT,
    "@type": "QAPage",
    url: `${SITE_URL}${url}`,
    mainEntity: {
      "@type": "Question",
      name: question,
      text: question,
      answerCount: 1,
      acceptedAnswer: {
        "@type": "Answer",
        text: answer.slice(0, 2000), // Reasonable limit
        author: {
          "@type": "Organization",
          name: author ?? getSiteConfig().name,
        },
        upvoteCount: upvoteCount ?? 0,
      },
    },
  };

  if (createdAt) {
    (qaPage.mainEntity as Record<string, unknown>).dateCreated = createdAt;
  }

  return qaPage;
}

/**
 * Generate VideoObject schema with full metadata
 * Helps videos appear in video rich results
 */
export function generateVideoObjectSchema(params: {
  name: string;
  description: string;
  videoId: string;
  thumbnailUrl?: string;
  embedUrl?: string;
  uploadDate?: string;
  duration?: string;
  channelName?: string;
  transcript?: string;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  familyFriendly?: boolean;
  regionsAllowed?: string[];
}) {
  const {
    name,
    description,
    videoId,
    thumbnailUrl,
    embedUrl = `https://www.youtube.com/embed/${videoId}`,
    uploadDate,
    duration,
    channelName,
    transcript,
    viewCount,
    likeCount,
    commentCount,
    familyFriendly = true,
    regionsAllowed = ["US", "GB", "CA", "AU"],
  } = params;

  const video: Record<string, unknown> = {
    "@context": BASE_CONTEXT,
    "@type": "VideoObject",
    name,
    description: description.slice(0, 500),
    thumbnailUrl: [
      thumbnailUrl ?? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    ],
    uploadDate,
    embedUrl,
    contentUrl: `https://www.youtube.com/watch?v=${videoId}`,
    familyFriendly,
  };

  if (duration) {
    video.duration = parseDuration(duration);
  }

  if (channelName) {
    video.creator = {
      "@type": "Organization",
      name: channelName,
    };
    video.publisher = {
      "@type": "Organization",
      name: channelName,
      url: `https://www.youtube.com/@${channelName}`,
    };
  }

  if (transcript) {
    video.transcript = transcript.slice(0, 2000);
  }

  // Add interaction statistics
  const interactions: Array<Record<string, unknown>> = [];
  if (typeof viewCount === "number" && viewCount > 0) {
    interactions.push({
      "@type": "InteractionCounter",
      interactionType: { "@type": "WatchAction" },
      userInteractionCount: viewCount,
    });
  }
  if (typeof likeCount === "number" && likeCount > 0) {
    interactions.push({
      "@type": "InteractionCounter",
      interactionType: { "@type": "LikeAction" },
      userInteractionCount: likeCount,
    });
  }
  if (typeof commentCount === "number" && commentCount > 0) {
    interactions.push({
      "@type": "InteractionCounter",
      interactionType: { "@type": "CommentAction" },
      userInteractionCount: commentCount,
    });
  }
  if (interactions.length > 0) {
    video.interactionStatistic = interactions;
  }

  if (regionsAllowed.length > 0) {
    video.regionsAllowed = regionsAllowed;
  }

  return video;
}

/**
 * Parse YouTube duration format (PT4M32S) to ISO 8601
 */
function parseDuration(duration: string): string {
  // If already in ISO format, return as is
  if (duration.startsWith("PT")) {
    return duration;
  }

  // Parse format like "4:32" or "1:04:32"
  const parts = duration.split(":").map(Number);

  if (parts.length === 2) {
    // MM:SS
    return `PT${parts[0]}M${parts[1]}S`;
  } else if (parts.length === 3) {
    // HH:MM:SS
    return `PT${parts[0]}H${parts[1]}M${parts[2]}S`;
  }

  return "PT0S";
}

/**
 * Generate WebPage schema for generic pages
 */
export function generateWebPageSchema(params: {
  title: string;
  description: string;
  url: string;
  dateModified?: string;
  breadcrumbs?: BreadcrumbItem[];
}) {
  const { title, description, url, dateModified, breadcrumbs } = params;

  const webPage: Record<string, unknown> = {
    "@context": BASE_CONTEXT,
    "@type": "WebPage",
    "@id": `${SITE_URL}${url}#webpage`,
    url: `${SITE_URL}${url}`,
    name: title,
    description: description.slice(0, 160),
    inLanguage: "en-US",
    isPartOf: {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
    },
    about: {
      "@type": "Thing",
      name: "Elon Musk",
      description: "Entrepreneur, CEO of Tesla and SpaceX",
    },
    breadcrumb: breadcrumbs
      ? {
          "@type": "BreadcrumbList",
          itemListElement: breadcrumbs.map((item, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: item.name,
            ...(item.url && { item: item.url }),
          })),
        }
      : undefined,
  };

  if (dateModified) {
    webPage.dateModified = dateModified;
  }

  return webPage;
}

/**
 * Generate SocialMediaPosting schema for tweet pages
 */
export function generateSocialMediaPostingSchema(params: {
  text: string;
  url: string;
  sourceUrl?: string;
  datePublished?: string;
  authorName?: string;
  likeCount?: number;
  replyCount?: number;
  retweetCount?: number;
  viewCount?: number;
}) {
  const {
    text,
    url,
    sourceUrl,
    datePublished,
    authorName = "Elon Musk",
    likeCount,
    replyCount,
    retweetCount,
    viewCount,
  } = params;

  const interactions: Array<Record<string, unknown>> = [];

  if (typeof likeCount === "number" && likeCount > 0) {
    interactions.push({
      "@type": "InteractionCounter",
      interactionType: { "@type": "LikeAction" },
      userInteractionCount: likeCount,
    });
  }

  if (typeof replyCount === "number" && replyCount > 0) {
    interactions.push({
      "@type": "InteractionCounter",
      interactionType: { "@type": "CommentAction" },
      userInteractionCount: replyCount,
    });
  }

  if (typeof retweetCount === "number" && retweetCount > 0) {
    interactions.push({
      "@type": "InteractionCounter",
      interactionType: { "@type": "ShareAction" },
      userInteractionCount: retweetCount,
    });
  }

  if (typeof viewCount === "number" && viewCount > 0) {
    interactions.push({
      "@type": "InteractionCounter",
      interactionType: { "@type": "ViewAction" },
      userInteractionCount: viewCount,
    });
  }

  const post: Record<string, unknown> = {
    "@context": BASE_CONTEXT,
    "@type": "SocialMediaPosting",
    url: `${SITE_URL}${url}`,
    headline: text.replace(/\s+/g, " ").slice(0, 110),
    articleBody: text,
    datePublished,
    author: {
      "@type": "Person",
      name: authorName,
    },
    ...(sourceUrl && { sameAs: sourceUrl }),
  };

  if (interactions.length > 0) {
    post.interactionStatistic = interactions;
  }

  return post;
}

/**
 * Generate Person schema for Elon Musk with full details
 */
export function generatePersonSchema() {
  return {
    "@context": BASE_CONTEXT,
    "@type": "Person",
    "@id": `${SITE_URL}/#person`,
    name: "Elon Musk",
    url: `${SITE_URL}`,
    sameAs: [
      "https://twitter.com/elonmusk",
      "https://x.com/elonmusk",
      "https://www.wikipedia.org/wiki/Elon_Musk",
      "https://www.linkedin.com/in/elonmusk",
    ],
    jobTitle: "CEO",
    worksFor: [
      {
        "@type": "Organization",
        name: "Tesla",
        url: "https://www.tesla.com",
      },
      {
        "@type": "Organization",
        name: "SpaceX",
        url: "https://www.spacex.com",
      },
      {
        "@type": "Organization",
        name: "X Corp",
        url: "https://x.com",
      },
      {
        "@type": "Organization",
        name: "Neuralink",
        url: "https://neuralink.com",
      },
      {
        "@type": "Organization",
        name: "The Boring Company",
        url: "https://www.boringcompany.com",
      },
    ],
    birthDate: "1971-06-28",
    birthPlace: {
      "@type": "Place",
      name: "Pretoria, South Africa",
    },
    description:
      "Entrepreneur and business magnate. Founder, CEO, and CTO of SpaceX; CEO and product architect of Tesla, Inc.; owner and CTO of X (formerly Twitter); founder of the Boring Company; co-founder of Neuralink and OpenAI.",
    knowsAbout: [
      "Electric Vehicles",
      "Space Exploration",
      "Artificial Intelligence",
      "Renewable Energy",
      "Social Media",
      "Neurotechnology",
    ],
  };
}

/**
 * Generate ProfilePage schema for topic hubs and profile pages
 * Enhanced with about entity and subject reference
 */
export function generateProfilePageSchema(params: {
  topic: string;
  description: string;
  url: string;
  pageCount?: number;
  subjectOf?: string;
  mainEntity?: {
    "@type": string;
    name: string;
    description?: string;
    sameAs?: string[];
  };
}) {
  const { topic, description, url, pageCount, subjectOf, mainEntity } = params;

  const schema: Record<string, unknown> = {
    "@context": BASE_CONTEXT,
    "@type": "CollectionPage",
    "@id": `${SITE_URL}${url}#collectionpage`,
    name: `${topic} — Topic Hub`,
    description: description.slice(0, 160),
    url: `${SITE_URL}${url}`,
    about: {
      "@type": "Thing",
      name: topic,
    },
    numberOfItems: pageCount ?? 0,
    isPartOf: {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: getSiteConfig().name,
    },
  };

  if (subjectOf) {
    schema.subjectOf = {
      "@type": "Event",
      name: subjectOf,
    };
  }

  if (mainEntity) {
    schema.mainEntity = mainEntity;
  }

  return schema;
}

/**
 * Generate AboutPage schema for /facts/ pages
 * Specifically for pages about Elon Musk's personal information
 */
export function generateAboutPageSchema(params: {
  title: string;
  description: string;
  url: string;
  subject: "Elon Musk";
  facts: Array<{
    name: string;
    value: string | number;
    dateVerified?: string;
  }>;
}) {
  const { title, description, url, subject, facts } = params;

  return {
    "@context": BASE_CONTEXT,
    "@type": "AboutPage",
    "@id": `${SITE_URL}${url}#aboutpage`,
    url: `${SITE_URL}${url}`,
    name: title,
    description: description.slice(0, 160),
    about: {
      "@type": "Person",
      name: subject,
      "@id": `${SITE_URL}/#person`,
    },
    mainEntity: {
      "@type": "Person",
      name: subject,
      description: facts.map((f) => `${f.name}: ${f.value}`).join("; "),
    },
    subjectOf: facts.map((fact) => ({
      "@type": "PropertyValue",
      name: fact.name,
      value: String(fact.value),
      ...(fact.dateVerified && {
        propertyID: "dateVerified",
        value: fact.dateVerified,
      }),
    })),
    isPartOf: {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
    },
  };
}

/**
 * Aggregate multiple schemas into a single JSON-LD array
 * Useful for pages that need multiple schema types
 */
export function combineSchemas(...schemas: Record<string, unknown>[]) {
  return schemas;
}

/**
 * Type guard for schema objects
 */
export function isValidSchema(obj: unknown): obj is Record<string, unknown> {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "@context" in obj &&
    "@type" in obj
  );
}

/**
 * HowTo step interface
 */
export interface HowToStep {
  name: string;
  text: string;
  url?: string;
  image?: string;
}

/**
 * Generate HowTo schema for tutorial/guide pages
 * Helps content appear in HowTo rich results
 */
export function generateHowToSchema(params: {
  name: string;
  description: string;
  url: string;
  steps: HowToStep[];
  totalTime?: string;
  estimatedCost?: {
    currency: string;
    value: string;
  };
  supply?: string[];
  tool?: string[];
  image?: string;
}) {
  const {
    name,
    description,
    url,
    steps,
    totalTime,
    estimatedCost,
    supply,
    tool,
    image,
  } = params;

  const howTo: Record<string, unknown> = {
    "@context": BASE_CONTEXT,
    "@type": "HowTo",
    name,
    description: description.slice(0, 500),
    url: `${SITE_URL}${url}`,
    step: steps.map((step, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      name: step.name,
      text: step.text,
      ...(step.url && { url: step.url }),
      ...(step.image && {
        image: {
          "@type": "ImageObject",
          url: step.image,
        },
      }),
    })),
  };

  if (totalTime) {
    howTo.totalTime = totalTime;
  }

  if (estimatedCost) {
    howTo.estimatedCost = {
      "@type": "MonetaryAmount",
      currency: estimatedCost.currency,
      value: estimatedCost.value,
    };
  }

  if (supply && supply.length > 0) {
    howTo.supply = supply.map((s) => ({
      "@type": "HowToSupply",
      name: s,
    }));
  }

  if (tool && tool.length > 0) {
    howTo.tool = tool.map((t) => ({
      "@type": "HowToTool",
      name: t,
    }));
  }

  if (image) {
    howTo.image = {
      "@type": "ImageObject",
      url: image.startsWith("http") ? image : `${SITE_URL}${image}`,
    };
  }

  return howTo;
}

/**
 * ItemList item interface
 */
export interface ItemListItem {
  name: string;
  url: string;
  description?: string;
  image?: string;
}

/**
 * Generate ItemList schema for index/listing pages
 * Helps Google understand page collections
 */
export function generateItemListSchema(params: {
  name: string;
  description: string;
  url: string;
  items: ItemListItem[];
  itemListOrder?: "Ascending" | "Descending" | "Unordered";
}) {
  const { name, description, url, items, itemListOrder = "Unordered" } = params;

  return {
    "@context": BASE_CONTEXT,
    "@type": "ItemList",
    name,
    description: description.slice(0, 500),
    url: `${SITE_URL}${url}`,
    numberOfItems: items.length,
    itemListOrder: `https://schema.org/ItemListOrder${itemListOrder}`,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: item.url.startsWith("http") ? item.url : `${SITE_URL}${item.url}`,
      ...(item.description && { description: item.description.slice(0, 200) }),
      ...(item.image && {
        image: {
          "@type": "ImageObject",
          url: item.image.startsWith("http")
            ? item.image
            : `${SITE_URL}${item.image}`,
        },
      }),
    })),
  };
}

/**
 * Speakable selector interface
 */
export interface SpeakableSelector {
  cssSelector?: string[];
  xpath?: string[];
}

/**
 * Generate Speakable schema for voice search optimization
 * Marks content sections that are particularly suitable for text-to-speech
 */
export function generateSpeakableSchema(params: {
  url: string;
  cssSelector?: string[];
  xpath?: string[];
}) {
  const { url, cssSelector, xpath } = params;

  const speakable: Record<string, unknown> = {
    "@type": "SpeakableSpecification",
  };

  if (cssSelector && cssSelector.length > 0) {
    speakable.cssSelector = cssSelector;
  }

  if (xpath && xpath.length > 0) {
    speakable.xpath = xpath;
  }

  // If no selectors provided, use common article selectors
  if (!cssSelector && !xpath) {
    speakable.cssSelector = [
      "article h1",
      "article h2",
      "article > section > p:first-of-type",
      "[data-speakable]",
    ];
  }

  return {
    "@context": BASE_CONTEXT,
    "@type": "WebPage",
    url: `${SITE_URL}${url}`,
    speakable,
  };
}

/**
 * Generate combined Article schema with Speakable for voice search
 */
export function generateArticleWithSpeakableSchema(params: {
  title: string;
  description: string;
  url: string;
  publishedAt?: string;
  updatedAt?: string;
  authorName?: string;
  imageUrl?: string;
  section?: string;
  keywords?: string[];
  speakableSelectors?: string[];
}) {
  const articleSchema = generateArticleSchema(params);

  // Add speakable specification
  (articleSchema as Record<string, unknown>).speakable = {
    "@type": "SpeakableSpecification",
    cssSelector: params.speakableSelectors ?? [
      "article h1",
      "article h2",
      "article > section > p:first-of-type",
    ],
  };

  return articleSchema;
}

/**
 * Extract HowTo steps from markdown content
 * Parses numbered lists and headers to create structured steps
 */
export function extractHowToStepsFromMarkdown(markdown: string): HowToStep[] {
  const steps: HowToStep[] = [];

  // Pattern 1: Numbered headers (## 1. Step Name, ### Step 1: Name)
  const headerPattern = /#{2,3}\s*(?:Step\s*)?(\d+)[.:]\s*(.+?)(?:\n|$)/gi;
  let match;

  while ((match = headerPattern.exec(markdown)) !== null) {
    const stepName = match[2].trim();
    // Get content until next header or end
    const startIdx = match.index + match[0].length;
    const nextHeaderMatch = markdown.slice(startIdx).match(/\n#{2,3}\s/);
    const endIdx = nextHeaderMatch
      ? startIdx + (nextHeaderMatch.index ?? 0)
      : markdown.length;
    const stepText = markdown
      .slice(startIdx, endIdx)
      .trim()
      .replace(/\n+/g, " ")
      .slice(0, 500);

    if (stepName && stepText) {
      steps.push({ name: stepName, text: stepText });
    }
  }

  // Pattern 2: Numbered list items (1. Do this, 2. Then that)
  if (steps.length === 0) {
    const listPattern = /^(\d+)\.\s+(.+?)(?:\n|$)/gm;
    while ((match = listPattern.exec(markdown)) !== null) {
      const stepText = match[2].trim();
      if (stepText.length > 10) {
        steps.push({
          name: `Step ${match[1]}`,
          text: stepText.slice(0, 500),
        });
      }
    }
  }

  return steps;
}

/**
 * Check if content appears to be a HowTo/tutorial
 */
export function isHowToContent(markdown: string, title: string): boolean {
  const howToIndicators = [
    /how\s+to\s+/i,
    /step[s]?\s+(?:by\s+step|to|for)/i,
    /guide\s+(?:to|for|on)/i,
    /tutorial/i,
    /instructions?\s+(?:for|to|on)/i,
    /learn\s+(?:how\s+)?to/i,
    /^\d+\.\s+/m, // Starts with numbered list
    /##\s*Step\s*\d/i, // Has step headers
  ];

  const combinedText = `${title} ${markdown.slice(0, 1000)}`;

  return howToIndicators.some((pattern) => pattern.test(combinedText));
}

/**
 * Generate NewsArticle schema for timely content
 * Better for content that has news value
 */
export function generateNewsArticleSchema(params: {
  headline: string;
  description: string;
  url: string;
  datePublished: string;
  dateModified?: string;
  imageUrl?: string;
  keywords?: string[];
}) {
  const {
    headline,
    description,
    url,
    datePublished,
    dateModified,
    imageUrl,
    keywords,
  } = params;

  return {
    "@context": BASE_CONTEXT,
    "@type": "NewsArticle",
    "@id": `${SITE_URL}${url}#newsarticle`,
    headline: headline.slice(0, 110),
    description: description.slice(0, 200),
    url: `${SITE_URL}${url}`,
    datePublished,
    dateModified: dateModified ?? datePublished,
    author: {
      "@type": "Organization",
      name: getSiteConfig().name,
      url: SITE_URL,
    },
    publisher: {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: getSiteConfig().name,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/logo.svg`,
        width: 600,
        height: 60,
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${SITE_URL}${url}`,
    },
    ...(imageUrl && {
      image: {
        "@type": "ImageObject",
        url: imageUrl.startsWith("http") ? imageUrl : `${SITE_URL}${imageUrl}`,
        width: 1200,
        height: 630,
      },
    }),
    ...(keywords && { keywords: keywords.join(", ") }),
    inLanguage: "en-US",
    isAccessibleForFree: true,
  };
}

/**
 * Generate Dataset schema for data-rich pages
 * Useful for pages with statistics or data tables
 */
export function generateDatasetSchema(params: {
  name: string;
  description: string;
  url: string;
  dateModified?: string;
  keywords?: string[];
  variableMeasured?: string[];
  temporalCoverage?: string;
}) {
  const {
    name,
    description,
    url,
    dateModified,
    keywords,
    variableMeasured,
    temporalCoverage,
  } = params;

  return {
    "@context": BASE_CONTEXT,
    "@type": "Dataset",
    name,
    description: description.slice(0, 500),
    url: `${SITE_URL}${url}`,
    creator: {
      "@type": "Organization",
      name: getSiteConfig().name,
      url: SITE_URL,
    },
    ...(dateModified && { dateModified }),
    ...(keywords && { keywords: keywords.join(", ") }),
    ...(variableMeasured && {
      variableMeasured: variableMeasured.map((v) => ({
        "@type": "PropertyValue",
        name: v,
      })),
    }),
    ...(temporalCoverage && { temporalCoverage }),
    license: "https://creativecommons.org/licenses/by-nc/4.0/",
    isAccessibleForFree: true,
  };
}

/**
 * Generate DefinedTerm schema for glossary/definition pages
 * Helps with featured snippets for "what is" queries
 */
export function generateDefinedTermSchema(params: {
  term: string;
  definition: string;
  url: string;
  relatedTerms?: string[];
}) {
  const { term, definition, url, relatedTerms } = params;

  return {
    "@context": BASE_CONTEXT,
    "@type": "DefinedTerm",
    name: term,
    description: definition.slice(0, 500),
    url: `${SITE_URL}${url}`,
    inDefinedTermSet: {
      "@type": "DefinedTermSet",
      name: "ElonGoat Knowledge Base",
      url: `${SITE_URL}/topics`,
    },
    ...(relatedTerms && {
      sameAs: relatedTerms.map((t) => `${SITE_URL}/q/${t}`),
    }),
  };
}

/**
 * Generate ClaimReview schema for fact-check style content
 * Useful for Q&A pages that verify claims
 */
export function generateClaimReviewSchema(params: {
  claim: string;
  url: string;
  rating: "True" | "Mostly True" | "Mixed" | "Mostly False" | "False";
  reviewBody: string;
  datePublished?: string;
}) {
  const { claim, url, rating, reviewBody, datePublished } = params;

  const ratingValue: Record<string, number> = {
    True: 5,
    "Mostly True": 4,
    Mixed: 3,
    "Mostly False": 2,
    False: 1,
  };

  return {
    "@context": BASE_CONTEXT,
    "@type": "ClaimReview",
    url: `${SITE_URL}${url}`,
    claimReviewed: claim,
    author: {
      "@type": "Organization",
      name: getSiteConfig().name,
      url: SITE_URL,
    },
    reviewRating: {
      "@type": "Rating",
      ratingValue: ratingValue[rating],
      bestRating: 5,
      worstRating: 1,
      alternateName: rating,
    },
    itemReviewed: {
      "@type": "Claim",
      author: {
        "@type": "Person",
        name: "Various Sources",
      },
    },
    reviewBody: reviewBody.slice(0, 500),
    ...(datePublished && { datePublished }),
  };
}

/**
 * Generate comprehensive page schema combining multiple types
 * Use this for important landing pages
 */
export function generateComprehensivePageSchema(params: {
  title: string;
  description: string;
  url: string;
  type: "topic" | "article" | "qa" | "video" | "fact";
  dateModified?: string;
  keywords?: string[];
  breadcrumbs?: BreadcrumbItem[];
}) {
  const { title, description, url, type, dateModified, keywords, breadcrumbs } =
    params;

  const schemas: Record<string, unknown>[] = [
    generateWebPageSchema({
      title,
      description,
      url,
      dateModified,
      breadcrumbs,
    }),
  ];

  // Add type-specific schema
  if (type === "article" || type === "topic") {
    schemas.push(
      generateArticleSchema({
        title,
        description,
        url,
        updatedAt: dateModified,
        keywords,
      }),
    );
  }

  // Add breadcrumb schema if provided
  if (breadcrumbs && breadcrumbs.length > 0) {
    schemas.push(generateBreadcrumbSchema(breadcrumbs));
  }

  return schemas;
}
