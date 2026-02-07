import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import dynamic from "next/dynamic";
import "./globals.css";

import { BackgroundFX } from "../components/BackgroundFX";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { SiteHeader } from "../components/SiteHeader";
import { SearchProvider } from "../components/SearchProvider";
import { SearchModal } from "../components/SearchModal";
import { ToastProvider } from "../components/Toast";
import { getPublicEnv } from "../lib/env";

// Lazy load ChatWidget for better initial page load performance
const ChatWidget = dynamic(
  () => import("../components/ChatWidget").then((mod) => mod.ChatWidget),
  { ssr: false },
);

// Lazy load WebVitals monitoring (non-critical)
const WebVitals = dynamic(
  () => import("../components/WebVitals"),
  { ssr: false },
);

const env = getPublicEnv();
const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap", // Core Web Vitals optimization - prevents FOUT/FOIT
  preload: true,
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap", // Core Web Vitals optimization
  preload: true,
});

export const metadata: Metadata = {
  metadataBase: new URL(env.NEXT_PUBLIC_SITE_URL ?? "https://elongoat.io"),
  title: {
    default: "ElonGoat — Digital Elon (AI)",
    template: "%s — ElonGoat",
  },
  description:
    "A sci‑fi knowledge base + streaming AI chat inspired by Elon Musk (not affiliated).",
  alternates: { canonical: "/" },
  keywords: [
    "Elon Musk",
    "AI chat",
    "knowledge base",
    "ElonSim",
    "Tesla",
    "SpaceX",
    "X/Twitter",
    "tech questions",
  ],
  authors: [{ name: "ElonGoat" }],
  creator: "ElonGoat",
  publisher: "ElonGoat",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    siteName: "ElonGoat",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: "ElonGoat — Digital Elon (AI)",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    creator: "@elongoat",
    site: "@elongoat",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    // Add your verification codes here when available
    // google: "verification-token",
    // yandex: "verification-token",
  },
  other: {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  },
};

// Core Web Vitals optimization - viewport configuration
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Critical CSS for LCP optimization - inline above-the-fold styles */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              /* Critical path CSS for faster LCP */
              body{background:#000;color:#fff;margin:0}
              .hero-cosmic{background:linear-gradient(135deg,rgba(99,102,241,0.1),rgba(16,185,129,0.05))}
              .glass-premium{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);backdrop-filter:blur(12px)}
              .text-gradient-bold{background:linear-gradient(135deg,#fff,rgba(255,255,255,0.7));-webkit-background-clip:text;background-clip:text;color:transparent}
            `,
          }}
        />

        {/* Performance: Preconnect hints for YouTube images */}
        <link rel="preconnect" href="https://img.youtube.com" />
        <link rel="dns-prefetch" href="https://i.ytimg.com" />

        {/* Performance: Preconnect to API for faster chat */}
        <link rel="preconnect" href="https://api.elongoat.io" />
        <link rel="dns-prefetch" href="https://api.elongoat.io" />

        {/* Core Web Vitals: Preload critical resources */}
        <link
          rel="preload"
          href="/fonts/GeistVF.woff"
          as="font"
          type="font/woff"
          crossOrigin="anonymous"
        />

        {/* SEO: Canonical and alternate links handled by metadata */}

        {/* Additional security meta tags */}
        <meta httpEquiv="X-Content-Type-Options" content="nosniff" />
        <meta httpEquiv="X-Frame-Options" content="DENY" />
        <meta name="referrer" content="strict-origin-when-cross-origin" />

        {/* Performance: Resource hints for common navigations */}
        <link rel="prefetch" href="/topics" />
        <link rel="prefetch" href="/q" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-dvh bg-black text-white antialiased`}
      >
        <a href="#main-content" className="skip-to-main">
          Skip to main content
        </a>
        <ToastProvider>
          <SearchProvider>
            <BackgroundFX />
            <SiteHeader />
            <main
              id="main-content"
              className="mx-auto w-full max-w-6xl px-4 py-10 md:px-6"
            >
              {children}
            </main>
            <footer className="mx-auto w-full max-w-6xl px-4 pb-10 text-xs text-white/50 md:px-6">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                {/* SEO Footer Links */}
                <nav className="mb-4 flex flex-wrap gap-x-4 gap-y-2 text-white/60" aria-label="Footer navigation">
                  <a href="/topics" className="hover:text-white transition-colors">Topics</a>
                  <a href="/q" className="hover:text-white transition-colors">Q&A</a>
                  <a href="/facts" className="hover:text-white transition-colors">Facts</a>
                  <a href="/tweets" className="hover:text-white transition-colors">Tweets</a>
                  <a href="/writing" className="hover:text-white transition-colors">Writing</a>
                  <a href="/videos" className="hover:text-white transition-colors">Videos</a>
                  <a href="/about" className="hover:text-white transition-colors">About</a>
                </nav>
                <div className="text-white/70">
                  Disclaimer: This is an AI simulation built for information and
                  entertainment. Not affiliated with Elon Musk or his companies.
                </div>
                <div className="mt-1">
                  © {new Date().getFullYear()} ElonGoat • Built on Next.js • Streaming chat in the corner
                </div>
              </div>
            </footer>
            <ErrorBoundary>
              <ChatWidget />
            </ErrorBoundary>
            <SearchModal />
            <WebVitals />
          </SearchProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
