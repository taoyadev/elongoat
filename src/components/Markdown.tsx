import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { slugify } from "../lib/slugify";

export function Markdown({ content }: { content: string }) {
  const components: Components = {
    h1: ({ children, ...props }) => {
      const text = typeof children === "string" ? children : String(children);
      const id = slugify(text);
      return (
        <h1
          id={id}
          className="text-2xl font-bold text-white scroll-mt-24"
          {...props}
        >
          {children}
        </h1>
      );
    },
    h2: ({ children, ...props }) => {
      const text = typeof children === "string" ? children : String(children);
      const id = slugify(text);
      return (
        <h2
          id={id}
          className="text-xl font-semibold text-white mt-8 mb-4 scroll-mt-24"
          {...props}
        >
          {children}
        </h2>
      );
    },
    h3: ({ children, ...props }) => {
      const text = typeof children === "string" ? children : String(children);
      const id = slugify(text);
      return (
        <h3
          id={id}
          className="text-lg font-semibold text-white mt-6 mb-3 scroll-mt-24"
          {...props}
        >
          {children}
        </h3>
      );
    },
    h4: ({ children, ...props }) => {
      const text = typeof children === "string" ? children : String(children);
      const id = slugify(text);
      return (
        <h4
          id={id}
          className="text-base font-semibold text-white mt-4 mb-2 scroll-mt-24"
          {...props}
        >
          {children}
        </h4>
      );
    },
    p: ({ children, ...props }) => (
      <p className="text-white/75 leading-relaxed mb-4" {...props}>
        {children}
      </p>
    ),
    a: ({ href, children, ...props }) => (
      <a
        href={href}
        className="text-accent hover:text-accent/80 underline transition-colors"
        rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
        {...props}
      >
        {children}
      </a>
    ),
    ul: ({ children, ...props }) => (
      <ul
        className="list-disc list-inside text-white/75 mb-4 space-y-2"
        {...props}
      >
        {children}
      </ul>
    ),
    ol: ({ children, ...props }) => (
      <ol
        className="list-decimal list-inside text-white/75 mb-4 space-y-2"
        {...props}
      >
        {children}
      </ol>
    ),
    li: ({ children, ...props }) => (
      <li className="text-white/75 ml-4" {...props}>
        {children}
      </li>
    ),
    blockquote: ({ children, ...props }) => (
      <blockquote
        className="border-l-4 border-accent/50 pl-4 italic text-white/70 my-4"
        {...props}
      >
        {children}
      </blockquote>
    ),
    code(props) {
      const { className, children, ...rest } = props;
      const match = /language-(\w+)/.exec(className ?? "");
      const isInline = !match && !String(children).includes("\n");
      return isInline ? (
        <code
          className="bg-white/10 px-1.5 py-0.5 rounded text-sm text-accent font-mono"
          {...rest}
        >
          {children}
        </code>
      ) : (
        <code
          className={`block bg-black/50 p-4 rounded-lg text-sm font-mono overflow-x-auto ${className ?? ""}`}
          {...rest}
        >
          {children}
        </code>
      );
    },
    pre: ({ children, ...props }) => (
      <pre
        className="bg-black/50 p-4 rounded-lg overflow-x-auto my-4"
        {...props}
      >
        {children}
      </pre>
    ),
    hr: () => <hr className="border-white/10 my-8" />,
    img: ({ src, alt, ...props }) => (
      <img
        src={src}
        alt={alt ?? ""}
        className="rounded-lg my-4 max-w-full h-auto"
        loading="lazy"
        {...props}
      />
    ),
    strong: ({ children, ...props }) => (
      <strong className="font-semibold text-white/95" {...props}>
        {children}
      </strong>
    ),
    table: ({ children, ...props }) => (
      <div className="overflow-x-auto my-4">
        <table className="min-w-full divide-y divide-white/10" {...props}>
          {children}
        </table>
      </div>
    ),
    thead: ({ children, ...props }) => (
      <thead className="bg-white/5" {...props}>
        {children}
      </thead>
    ),
    th: ({ children, ...props }) => (
      <th
        className="px-4 py-2 text-left text-xs font-medium text-white/70 uppercase tracking-wider"
        {...props}
      >
        {children}
      </th>
    ),
    td: ({ children, ...props }) => (
      <td className="px-4 py-2 text-sm text-white/75" {...props}>
        {children}
      </td>
    ),
  };

  return (
    <div className="prose prose-invert max-w-none prose-headings:scroll-mt-24">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
