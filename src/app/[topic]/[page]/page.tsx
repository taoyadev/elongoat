import type { Metadata } from "next";

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  Brain,
  Globe,
  MessageCircle,
  Rocket,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";

import { CopyPromptButton } from "../../../components/CopyPromptButton";
import { JsonLd } from "../../../components/JsonLd";
import { LastModified } from "../../../components/LastModified";
import { Markdown } from "../../../components/Markdown";
import { OpenChatButton } from "../../../components/OpenChatButton";
import { RelatedContent } from "../../../components/RelatedContent";
import { RelatedTweets } from "../../../components/RelatedTweets";
import { SeeAlso } from "../../../components/SeeAlso";
import { AuthorInfo } from "../../../components/AuthorInfo";
import { SerpInsightsServer } from "../../../components/SerpInsights";
import { ErrorBoundary } from "../../../components/ErrorBoundary";
import { TableOfContents } from "../../../components/TableOfContents";
import { getClusterPageContent } from "../../../lib/contentGen";
import {
  findPage,
  getClusterIndex,
  getTopPageSlugs,
  listTopicPages,
} from "../../../lib/indexes";
import { generateClusterPageMetadata } from "../../../lib/seo";
import {
  generateArticleWithSpeakableSchema,
  generateBreadcrumbSchema,
  generateHowToSchema,
  generateWebPageSchema,
  extractHowToStepsFromMarkdown,
  isHowToContent,
} from "../../../lib/structuredData";
import { getDynamicVariables } from "../../../lib/variables";
import { getHeatData, type HeatTier } from "../../../lib/keywordHeat";

export const revalidate = 3600;

const HEAT_STYLES: Record<
  HeatTier,
  { text: string; badge: string; dot: string }
> = {
  extreme: {
    text: "text-rose-200",
    badge: "border-rose-400/30 bg-rose-400/10",
    dot: "bg-rose-400",
  },
  very_high: {
    text: "text-orange-200",
    badge: "border-orange-400/30 bg-orange-400/10",
    dot: "bg-orange-400",
  },
  high: {
    text: "text-amber-200",
    badge: "border-amber-400/30 bg-amber-400/10",
    dot: "bg-amber-400",
  },
  medium: {
    text: "text-yellow-200",
    badge: "border-yellow-400/30 bg-yellow-400/10",
    dot: "bg-yellow-400",
  },
  low: {
    text: "text-white/60",
    badge: "border-white/15 bg-white/5",
    dot: "bg-white/40",
  },
};

export async function generateStaticParams() {
  // Try to fetch all article slugs from API (for full static generation)
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://api.elongoat.io";
  try {
    const res = await fetch(`${apiUrl}/api/articles/slugs`, {
      next: { revalidate: 3600 },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.slugs && data.slugs.length > 0) {
        console.log(
          `[generateStaticParams] Fetched ${data.slugs.length} slugs from API`,
        );
        return data.slugs.map((s: string) => {
          const [topic, page] = s.split("/");
          return { topic, page };
        });
      }
    }
  } catch (e) {
    console.warn(
      "[generateStaticParams] API fetch failed, falling back to top pages:",
      e,
    );
  }

  // Fallback to top pages from JSON index
  const slugs = await getTopPageSlugs();
  return slugs.map((s) => {
    const [topic, page] = s.split("/");
    return { topic, page };
  });
}

export async function generateMetadata({
  params,
}: {
  params: { topic: string; page: string };
}): Promise<Metadata> {
  const page = await findPage(params.topic, params.page);
  if (!page)
    return {
      title: "Page not found",
      robots: { index: false },
    };

  return generateClusterPageMetadata({
    page: page.page,
    topic: page.topic,
    maxVolume: page.maxVolume,
    keywordCount: page.keywordCount,
    topicSlug: page.topicSlug,
    pageSlug: page.pageSlug,
  });
}

export default async function ClusterPage({
  params,
}: {
  params: { topic: string; page: string };
}) {
  const [page, vars, cluster] = await Promise.all([
    findPage(params.topic, params.page),
    getDynamicVariables(),
    getClusterIndex(),
  ]);
  if (!page) return notFound();

  const ai = await getClusterPageContent({
    topicSlug: params.topic,
    pageSlug: params.page,
  });

  const related = (await listTopicPages(page.topicSlug))
    .filter((p) => p.pageSlug !== page.pageSlug)
    .slice(0, 8);

  const keywords = `${page.page} ${page.topic} ${page.topKeywords
    .map((k) => k.keyword)
    .slice(0, 5)
    .join(" ")}`;

  const keywordsList = page.topKeywords.map((k) => k.keyword).slice(0, 10);
  const maxKeywordVolume = Math.max(
    1,
    ...page.topKeywords.map((k) => k.volume),
  );
  const clusterUpdated = new Date(cluster.generatedAt);

  // Check if content is HowTo-style
  const contentIsHowTo = isHowToContent(ai.contentMd, page.page);
  const howToSteps = contentIsHowTo
    ? extractHowToStepsFromMarkdown(ai.contentMd)
    : [];

  // JSON-LD structured data
  const jsonLd: Record<string, unknown>[] = [
    generateWebPageSchema({
      title: `${page.page} — ${page.topic}`,
      description: `Explore "${page.page}" in ${page.topic}. ${page.keywordCount.toLocaleString()} related topics with AI chat and fresh sources.`,
      url: `/${page.topicSlug}/${page.pageSlug}`,
      dateModified: clusterUpdated.toISOString(),
      breadcrumbs: [
        { name: "Home", url: "/" },
        { name: "Topics", url: "/topics" },
        { name: page.topic, url: `/${page.topicSlug}` },
        { name: page.page, url: `/${page.topicSlug}/${page.pageSlug}` },
      ],
    }),
    // Use Article with Speakable for voice search optimization
    generateArticleWithSpeakableSchema({
      title: `${page.page} — ${page.topic}`,
      description: `Explore "${page.page}" in ${page.topic}. ${page.keywordCount.toLocaleString()} related topics with AI chat and fresh sources.`,
      url: `/${page.topicSlug}/${page.pageSlug}`,
      publishedAt: clusterUpdated.toISOString(),
      updatedAt: clusterUpdated.toISOString(),
      section: page.topic,
      keywords: [page.page, page.topic, ...keywordsList.slice(0, 3)],
      speakableSelectors: [
        "article h1",
        "article header p",
        "article section h2",
        "[data-speakable]",
      ],
    }),
    generateBreadcrumbSchema([
      { name: "Home", url: "/" },
      { name: "Topics", url: "/topics" },
      { name: page.topic, url: `/${page.topicSlug}` },
      { name: page.page, url: `/${page.topicSlug}/${page.pageSlug}` },
    ]),
  ];

  // Add HowTo schema if content has steps
  if (contentIsHowTo && howToSteps.length >= 2) {
    jsonLd.push(
      generateHowToSchema({
        name: page.page,
        description: `Step-by-step guide for ${page.page} in ${page.topic}`,
        url: `/${page.topicSlug}/${page.pageSlug}`,
        steps: howToSteps,
      }),
    );
  }

  return (
    <>
      <JsonLd data={jsonLd} />
      <article className="space-y-6">
        {/* Article Header - Knowledge Node */}
        <header className="hero-cosmic glass-premium glow-ring rounded-3xl p-6 md:p-8">
          <div className="relative">
            {/* Breadcrumbs */}
            <nav className="flex flex-wrap items-center gap-2 text-xs">
              <Link
                href="/topics"
                className="flex items-center gap-1 text-white/50 hover:text-accent transition-colors"
              >
                <Globe className="h-3 w-3" />
                Topics
              </Link>
              <ArrowRight className="h-3 w-3 text-white/20" />
              <Link
                href={`/${page.topicSlug}`}
                className="text-white/60 hover:text-accent transition-colors"
              >
                {page.topic}
              </Link>
              <ArrowRight className="h-3 w-3 text-white/20" />
              <span className="text-accent font-medium">{page.page}</span>
            </nav>

            {/* Title & Description */}
            <h1 className="mt-5 text-balance text-3xl font-bold tracking-tight text-white md:text-4xl lg:text-5xl">
              <span className="text-gradient-bold">{page.page}</span>
            </h1>
            <p
              className="mt-3 max-w-3xl text-sm text-white/70 md:text-base"
              data-speakable
            >
              Deep-dive into {page.page} — explore what people want to know and
              get AI-powered insights backed by real data.
            </p>
            <LastModified date={clusterUpdated} className="mt-4" />

            {/* CTA Buttons */}
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <OpenChatButton label="Ask the AI" className="btn-launch" />
              <Link
                href={`/${page.topicSlug}`}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white/90 transition hover:bg-white/10"
              >
                <Globe className="h-4 w-4" />
                Explore {page.topic}
              </Link>
              <Link
                href={`/facts/age`}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-accent3/20 bg-accent3/5 px-5 py-3 text-sm font-semibold text-accent3 transition hover:bg-accent3/10"
              >
                <Zap className="h-4 w-4" />
                Age: {vars.age}
              </Link>
            </div>
          </div>
        </header>

        {/* Stats & Metrics */}
        <section className="grid gap-4 md:grid-cols-2">
          <div className="stat-card group">
            <div className="flex items-center gap-2 text-xs text-white/55">
              <Search className="h-3 w-3 text-accent" />
              相关话题数
            </div>
            <div className="stat-card-value mt-2">
              {page.keywordCount.toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-white/40">
              你可能会关心的相关内容
            </div>
          </div>
          <div className="stat-card group">
            <div className="flex items-center gap-2 text-xs text-white/55">
              <Brain className="h-3 w-3 text-accent2" />
              Content Type
            </div>
            <div className="stat-card-value mt-2 text-lg">
              {page.pageType ?? "General"}
            </div>
            <div className="mt-1 text-xs text-white/40">
              Article classification
            </div>
          </div>
        </section>

        {/* First Principles Interpretation */}
        <section className="grid gap-6 md:grid-cols-5">
          <div className="glass-premium rounded-3xl p-6 md:col-span-3">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent3/10">
                <Rocket className="h-5 w-5 text-accent3" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">
                  First Principles Analysis
                </h2>
                <p className="text-xs text-white/50">
                  Breaking it down to fundamentals
                </p>
              </div>
            </div>
            <div className="space-y-4 text-sm">
              <p className="text-white/70">
                This knowledge cluster captures{" "}
                <span className="font-semibold text-white">real demand</span>{" "}
                related to{" "}
                <Link
                  href={`/${page.topicSlug}`}
                  className="text-accent hover:underline"
                >
                  {page.topic}
                </Link>
                . For the fastest answer, ask the AI a narrow question — include
                timeframe, location, or source preference.
              </p>
              <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-xs text-white/50">
                <Zap className="inline h-3 w-3 text-accent3 mr-1" />
                Note: Net worth and live news claims may be outdated. Verify
                with primary sources when accuracy matters.
              </div>
            </div>
          </div>

          <aside className="glass-premium rounded-3xl p-6 md:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent2/10">
                <MessageCircle className="h-5 w-5 text-accent2" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Smart Prompts
                </h2>
                <p className="text-xs text-white/50">Ask better questions</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <CopyPromptButton
                text={`Give me the 30-second answer for "${page.page}".`}
              />
              <CopyPromptButton
                text={`What changed in the last 30 days about "${page.page}"?`}
              />
              <CopyPromptButton
                text={`List primary sources to verify "${page.page}".`}
              />
              <CopyPromptButton
                text={`Explain "${page.page}" like I'm technical, not a beginner.`}
              />
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs text-white/40">
              <Sparkles className="h-3 w-3" />
              Click to copy, then ask the AI
            </div>
          </aside>
        </section>

        {/* Keywords Grid */}
        <section className="glass-premium rounded-3xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
              <Search className="h-5 w-5 text-accent" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">热门话题</h2>
              <p className="text-xs text-white/50">该主题下最受关注的内容</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {page.topKeywords.map((k, i) => {
              const heat = getHeatData(k.volume, maxKeywordVolume, "zh");
              const heatStyle = HEAT_STYLES[heat.tier];
              return (
                <div key={k.keyword} className="knowledge-node group">
                  <div className="flex items-start gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/10 text-xs font-bold text-accent shrink-0">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white group-hover:text-accent transition-colors">
                        {k.keyword}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${heatStyle.badge} ${heatStyle.text}`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${heatStyle.dot}`}
                          />
                          热度：{heat.label}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* AI Brief - The Main Content */}
        <section className="glass-premium glow-ring rounded-3xl p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent2">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">
                  AI Deep Dive
                </h2>
                <p className="text-xs text-white/50">Comprehensive analysis</p>
              </div>
            </div>
            <div className="badge-ai">
              {ai.model}
              {ai.cached && " • cached"}
            </div>
          </div>
          <div className="grid gap-6 lg:grid-cols-[1fr,280px]">
            <div className="prose prose-invert prose-sm max-w-none">
              <Markdown content={ai.contentMd} />
            </div>
            <aside className="hidden lg:block">
              <TableOfContents contentSelector=".prose" minItems={3} />
            </aside>
          </div>
        </section>

        <AuthorInfo lastUpdated={clusterUpdated} contentType="cluster" />

        <section className="glass-premium rounded-3xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
              <Globe className="h-5 w-5 text-accent" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                More in {page.topic}
              </h2>
              <p className="text-xs text-white/50">
                Related knowledge clusters
              </p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {related.map((p, i) => (
              <Link
                key={p.slug}
                href={`/${p.topicSlug}/${p.pageSlug}`}
                className="topic-card"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-xs font-bold text-accent shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white">
                    {p.page}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-white/50">
                    <Search className="h-3 w-3" />
                    {p.keywordCount.toLocaleString()} related topics
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-white/30 group-hover:text-accent transition-colors shrink-0" />
              </Link>
            ))}
          </div>
        </section>

        <RelatedTweets
          keywords={[page.page, page.topic, ...keywordsList.slice(0, 3)]}
          limit={4}
          title="What Elon said about this"
        />

        <RelatedContent
          type="page"
          topicSlug={page.topicSlug}
          currentSlug={page.slug}
          pageTitle={page.page}
          keywords={keywordsList}
        />

        <ErrorBoundary>
          <SerpInsightsServer
            query={page.page}
            limit={5}
            showPaa={true}
            showRelated={true}
            showResults={false}
            className="mt-6"
          />
        </ErrorBoundary>

        <SeeAlso
          type="page"
          keywords={keywords}
          topicSlug={page.topicSlug}
          currentSlug={page.slug}
        />
      </article>
    </>
  );
}
