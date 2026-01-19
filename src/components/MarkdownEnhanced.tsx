"use client";

import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import type { Components } from "react-markdown";

// ============================================================================
// Types
// ============================================================================

export interface MarkdownProps {
  content: string;
  className?: string;
  allowHtml?: boolean;
}

// ============================================================================
// Custom Components
// ============================================================================

// Custom link component with security and accessibility
const LinkComponent = memo<
  React.AnchorHTMLAttributes<HTMLAnchorElement> & { href?: string }
>(({ href, children, ...props }) => {
  if (!href) return <span {...props}>{children}</span>;

  const isExternal = href.startsWith("http");
  const isAnchor = href.startsWith("#");

  if (isAnchor) {
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          const target = document.querySelector(href);
          target?.scrollIntoView({ behavior: "smooth" });
        }}
        {...props}
      >
        {children}
      </a>
    );
  }

  return (
    <a
      href={href}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noopener noreferrer" : undefined}
      className="text-accent underline underline-offset-2 hover:text-accent/80"
      {...props}
    >
      {children}
    </a>
  );
});
LinkComponent.displayName = "LinkComponent";

// Custom code component with syntax highlighting placeholder
const CodeComponent = memo<
  React.HTMLAttributes<HTMLElement> & {
    className?: string;
    children?: React.ReactNode;
  }
>(({ className, children, ...props }) => {
  const match = /language-(\w+)/.exec(className || "");
  const isInline = !match;

  if (isInline) {
    return (
      <code
        className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-sm text-white/90"
        {...props}
      >
        {children}
      </code>
    );
  }

  const language = match?.[1] || "text";

  return (
    <div className="group relative my-4 rounded-xl bg-black/50">
      <div className="flex items-center justify-between rounded-t-xl border-b border-white/10 bg-white/5 px-4 py-2">
        <span className="text-xs text-white/50 font-mono">{language}</span>
        <button
          type="button"
          className="text-xs text-white/40 hover:text-white/70 transition-colors opacity-0 group-hover:opacity-100"
          onClick={() => {
            navigator.clipboard.writeText(String(children));
          }}
        >
          Copy
        </button>
      </div>
      <pre className="overflow-x-auto p-4">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    </div>
  );
});
CodeComponent.displayName = "CodeComponent";

// Custom heading component with anchor links
const HeadingComponent = memo<
  React.HTMLAttributes<HTMLHeadingElement> & { level: number }
>(({ level, children, id, ...props }) => {
  const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  const text = typeof children === "string" ? children : undefined;
  const anchorId = id || text?.toLowerCase().replace(/\s+/g, "-");

  return (
    <Tag id={anchorId} className="group scroll-mt-24" {...props}>
      <a
        href={`#${anchorId}`}
        className="no-underline group-hover:underline text-white/30 hover:text-accent mr-2 opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label={`Link to ${text}`}
      >
        #
      </a>
      {children}
    </Tag>
  );
});
HeadingComponent.displayName = "HeadingComponent";

// ============================================================================
// Markdown Components Configuration
// ============================================================================

const markdownComponents: Partial<Components> = {
  h1: (props) => <HeadingComponent level={1} {...props} />,
  h2: (props) => <HeadingComponent level={2} {...props} />,
  h3: (props) => <HeadingComponent level={3} {...props} />,
  h4: (props) => <HeadingComponent level={4} {...props} />,
  h5: (props) => <HeadingComponent level={5} {...props} />,
  h6: (props) => <HeadingComponent level={6} {...props} />,
  p: ({ children, ...props }) => (
    <p className="mb-4 leading-7 text-white/75" {...props}>
      {children}
    </p>
  ),
  a: LinkComponent,
  code: CodeComponent,
  ul: ({ children, ...props }) => (
    <ul className="my-4 ml-6 list-disc space-y-2 text-white/75" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="my-4 ml-6 list-decimal space-y-2 text-white/75" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="leading-relaxed" {...props}>
      {children}
    </li>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="my-4 border-l-4 border-accent3/50 pl-4 italic text-white/70"
      {...props}
    >
      {children}
    </blockquote>
  ),
  hr: (props) => <hr className="my-8 border-white/10" {...props} />,
  table: ({ children, ...props }) => (
    <div className="my-4 overflow-x-auto">
      <table
        className="min-w-full divide-y divide-white/10 rounded-xl border border-white/10"
        {...props}
      >
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => (
    <thead className="bg-white/5" {...props}>
      {children}
    </thead>
  ),
  tbody: ({ children, ...props }) => (
    <tbody className="divide-y divide-white/10" {...props}>
      {children}
    </tbody>
  ),
  tr: ({ children, ...props }) => (
    <tr className="hover:bg-white/5 transition-colors" {...props}>
      {children}
    </tr>
  ),
  th: ({ children }) => (
    <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wider">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-4 py-3 text-sm text-white/70">{children}</td>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-white/95" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="italic text-white/80" {...props}>
      {children}
    </em>
  ),
  img: ({ src, alt, ...props }) => (
    <img
      src={src}
      alt={alt || ""}
      className="rounded-xl my-4 max-w-full h-auto"
      loading="lazy"
      {...props}
    />
  ),
};

// ============================================================================
// Markdown Component
// ============================================================================

function MarkdownComponent({
  content,
  className = "",
  allowHtml = false,
}: MarkdownProps) {
  // Memoize the plugins and components to avoid re-renders
  const remarkPlugins = useMemo(() => {
    return [remarkGfm];
  }, []);

  const rehypePlugins = useMemo(() => {
    return !allowHtml ? [rehypeSanitize] : [];
  }, [allowHtml]);

  const components = useMemo(() => {
    return markdownComponents;
  }, []);

  return (
    <div
      className={`prose prose-invert prose-sm max-w-none prose-headings:font-semibold prose-a:no-underline ${className}`}
    >
      <ReactMarkdown
        components={components}
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// Export memoized component to prevent unnecessary re-renders
export const MarkdownEnhanced = memo(MarkdownComponent, (prev, next) => {
  return (
    prev.content === next.content &&
    prev.className === next.className &&
    prev.allowHtml === next.allowHtml
  );
});

MarkdownEnhanced.displayName = "MarkdownEnhanced";
