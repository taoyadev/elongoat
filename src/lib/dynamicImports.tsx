"use client";

/**
 * Dynamic imports for code-splitting and lazy loading
 * Use these for heavy components that don't need to be in the initial bundle
 */

import dynamic from "next/dynamic";

// ============================================================================
// Chat Components
// ============================================================================

export const ChatWidget = dynamic(
  () => import("../components/ChatWidget").then((mod) => mod.ChatWidget),
  {
    ssr: false,
    loading: () => (
      <div className="fixed bottom-4 right-4 z-50">
        <div className="h-14 w-14 animate-pulse rounded-2xl bg-white/10" />
      </div>
    ),
  },
);

// ============================================================================
// Search Components
// ============================================================================

export const SearchModal = dynamic(
  () => import("../components/SearchModal").then((mod) => mod.SearchModal),
  {
    ssr: false,
  },
);

// ============================================================================
// Content Components
// ============================================================================

export const TableOfContents = dynamic(
  () =>
    import("../components/TableOfContents").then((mod) => mod.TableOfContents),
  {
    ssr: false,
  },
);

export const RelatedContent = dynamic(
  () =>
    import("../components/RelatedContent").then((mod) => mod.RelatedContent),
  {
    ssr: true,
  },
);

// Note: VideoGrid, XTimeline, and TweetEmbed components are not currently in the codebase
// They can be added here when implemented
