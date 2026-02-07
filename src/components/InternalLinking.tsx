import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

export interface InternalLink {
  title: string;
  url: string;
  description?: string;
  priority?: "high" | "medium" | "low";
}

export interface InternalLinkingProps {
  /**
   * Links to display
   */
  links: InternalLink[];
  /**
   * Section title
   */
  title?: string;
  /**
   * Section description
   */
  description?: string;
  /**
   * Layout style
   */
  layout?: "grid" | "list" | "inline";
  /**
   * Additional className
   */
  className?: string;
}

/**
 * Internal Linking Component for SEO
 * Provides contextual internal links to improve:
 * - Crawlability and indexation
 * - PageRank distribution
 * - User engagement and time on site
 * - Topical authority signals
 */
export function InternalLinking({
  links,
  title = "Related Content",
  description,
  layout = "grid",
  className = "",
}: InternalLinkingProps) {
  if (links.length === 0) return null;

  // Sort by priority
  const sortedLinks = [...links].sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return (
      (priorityOrder[a.priority ?? "medium"] ?? 1) -
      (priorityOrder[b.priority ?? "medium"] ?? 1)
    );
  });

  if (layout === "inline") {
    return (
      <nav
        className={`flex flex-wrap gap-2 ${className}`}
        aria-label={title}
      >
        {sortedLinks.map((link) => (
          <Link
            key={link.url}
            href={link.url}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/80 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
          >
            {link.title}
          </Link>
        ))}
      </nav>
    );
  }

  if (layout === "list") {
    return (
      <nav className={`space-y-2 ${className}`} aria-label={title}>
        {title && (
          <h3 className="text-sm font-semibold text-white/70">{title}</h3>
        )}
        <ul className="space-y-1">
          {sortedLinks.map((link) => (
            <li key={link.url}>
              <Link
                href={link.url}
                className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
              >
                <ArrowRight className="h-3 w-3 text-white/30 transition group-hover:text-accent" />
                {link.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  // Grid layout (default)
  return (
    <section className={`glass-premium rounded-3xl p-6 ${className}`}>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
          <Sparkles className="h-5 w-5 text-accent" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          {description && (
            <p className="text-xs text-white/50">{description}</p>
          )}
        </div>
      </div>
      <nav
        className="grid gap-3 md:grid-cols-2"
        aria-label={title}
      >
        {sortedLinks.map((link, idx) => (
          <Link
            key={link.url}
            href={link.url}
            className="topic-card group"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/10 text-xs font-bold text-accent shrink-0">
              {idx + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-white group-hover:text-accent transition-colors">
                {link.title}
              </div>
              {link.description && (
                <div className="mt-0.5 text-xs text-white/50 line-clamp-1">
                  {link.description}
                </div>
              )}
            </div>
            <ArrowRight className="h-4 w-4 text-white/30 group-hover:text-accent transition-colors shrink-0" />
          </Link>
        ))}
      </nav>
    </section>
  );
}

/**
 * Breadcrumb navigation for SEO
 * Helps search engines understand site hierarchy
 */
export interface BreadcrumbItem {
  name: string;
  url?: string;
}

export interface BreadcrumbNavProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function BreadcrumbNav({ items, className = "" }: BreadcrumbNavProps) {
  return (
    <nav
      className={`flex flex-wrap items-center gap-2 text-xs ${className}`}
      aria-label="Breadcrumb"
    >
      <ol
        className="flex flex-wrap items-center gap-2"
        itemScope
        itemType="https://schema.org/BreadcrumbList"
      >
        {items.map((item, index) => (
          <li
            key={item.url ?? item.name}
            className="flex items-center gap-2"
            itemProp="itemListElement"
            itemScope
            itemType="https://schema.org/ListItem"
          >
            {index > 0 && (
              <ArrowRight className="h-3 w-3 text-white/20" aria-hidden />
            )}
            {item.url && index < items.length - 1 ? (
              <Link
                href={item.url}
                className="text-white/50 hover:text-accent transition-colors"
                itemProp="item"
              >
                <span itemProp="name">{item.name}</span>
              </Link>
            ) : (
              <span
                className={index === items.length - 1 ? "text-accent font-medium" : "text-white/80"}
                itemProp="name"
              >
                {item.name}
              </span>
            )}
            <meta itemProp="position" content={String(index + 1)} />
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Generate contextual internal links based on content
 */
export function generateContextualLinks(params: {
  currentPath: string;
  topic?: string;
  keywords?: string[];
  relatedTopics?: Array<{ slug: string; name: string }>;
  relatedPages?: Array<{ slug: string; title: string }>;
  relatedQuestions?: Array<{ slug: string; question: string }>;
}): InternalLink[] {
  const links: InternalLink[] = [];

  // Add topic link if available
  if (params.topic && params.relatedTopics) {
    params.relatedTopics.slice(0, 3).forEach((t) => {
      links.push({
        title: t.name,
        url: `/${t.slug}`,
        priority: "high",
      });
    });
  }

  // Add related pages
  if (params.relatedPages) {
    params.relatedPages.slice(0, 4).forEach((p) => {
      links.push({
        title: p.title,
        url: `/${p.slug}`,
        priority: "medium",
      });
    });
  }

  // Add related questions
  if (params.relatedQuestions) {
    params.relatedQuestions.slice(0, 3).forEach((q) => {
      links.push({
        title: q.question,
        url: `/q/${q.slug}`,
        priority: "medium",
      });
    });
  }

  return links;
}
