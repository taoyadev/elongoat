"use client";

import { memo } from "react";
import { Skeleton } from "./Skeleton";

// ============================================================================
// Page Loading State
// ============================================================================

export interface PageLoadingStateProps {
  title?: string;
  description?: string;
}

export const PageLoadingState = memo(
  ({ description }: PageLoadingStateProps) => (
    <div className="space-y-6 fade-in">
      <header className="space-y-4">
        <Skeleton height="48px" width="60%" className="max-w-md" />
        {description && (
          <Skeleton height="24px" width="40%" className="max-w-sm" />
        )}
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="glass rounded-3xl p-6">
            <Skeleton height="16px" width="80px" />
            <Skeleton height="32px" width="120px" className="mt-2" />
          </div>
        ))}
      </div>

      <div className="glass rounded-3xl p-6 space-y-4">
        <Skeleton height="24px" width="200px" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton
              key={i}
              height="16px"
              width={i % 3 === 0 ? "80%" : "100%"}
            />
          ))}
        </div>
      </div>
    </div>
  ),
);
PageLoadingState.displayName = "PageLoadingState";

// ============================================================================
// Spinner Loading State
// ============================================================================

export interface SpinnerLoadingStateProps {
  size?: "sm" | "md" | "lg";
  text?: string;
  fullscreen?: boolean;
}

export const SpinnerLoadingState = memo(
  ({ size = "md", text, fullscreen = false }: SpinnerLoadingStateProps) => {
    const sizeClasses = {
      sm: "h-6 w-6",
      md: "h-10 w-10",
      lg: "h-16 w-16",
    };

    const containerClasses = fullscreen
      ? "fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      : "flex items-center justify-center";

    return (
      <div className={containerClasses}>
        <div className="flex flex-col items-center gap-4">
          <div
            className={`${sizeClasses[size]} animate-spin rounded-full border-2 border-white/10 border-t-white`}
            role="status"
            aria-label={text || "Loading"}
          />
          {text && (
            <p className="text-sm text-white/60" aria-live="polite">
              {text}
            </p>
          )}
        </div>
      </div>
    );
  },
);
SpinnerLoadingState.displayName = "SpinnerLoadingState";

// ============================================================================
// Empty State
// ============================================================================

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const EmptyState = memo(
  ({ icon, title, description, action }: EmptyStateProps) => (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 bg-white/5 py-16 px-4 text-center">
      {icon && (
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 text-white/60">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      {description && (
        <p className="mt-2 max-w-sm text-sm text-white/60">{description}</p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-6 rounded-xl bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/90 active:scale-95"
        >
          {action.label}
        </button>
      )}
    </div>
  ),
);
EmptyState.displayName = "EmptyState";

// ============================================================================
// Error State
// ============================================================================

export interface ErrorStateProps {
  title?: string;
  message?: string;
  retryLabel?: string;
  onRetry?: () => void;
  code?: string;
}

export const ErrorState = memo(
  ({
    title = "Something went wrong",
    message = "An unexpected error occurred. Please try again.",
    retryLabel = "Try Again",
    onRetry,
    code,
  }: ErrorStateProps) => (
    <div className="flex min-h-[400px] items-center justify-center rounded-3xl border border-danger/20 bg-danger/5 p-8">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-danger/20">
          <svg
            className="h-8 w-8 text-danger"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>

        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <p className="text-sm text-white/60">{message}</p>
          {code && (
            <code className="text-xs text-white/40 font-mono">
              Error: {code}
            </code>
          )}
        </div>

        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/90 active:scale-95"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  ),
);
ErrorState.displayName = "ErrorState";

// ============================================================================
// Inline Loading Indicator
// ============================================================================

export interface InlineLoadingProps {
  text?: string;
  dots?: number;
}

export const InlineLoading = memo(
  ({ text = "Loading", dots = 3 }: InlineLoadingProps) => (
    <div className="inline-flex items-center gap-2">
      <span className="text-sm text-white/60">{text}</span>
      <span className="flex items-center gap-1">
        {Array.from({ length: dots }).map((_, i) => (
          <span
            key={i}
            className="h-1 w-1 animate-bounce rounded-full bg-white/40"
            style={{
              animationDelay: `${i * 150}ms`,
              animationDuration: "600ms",
            }}
          />
        ))}
      </span>
    </div>
  ),
);
InlineLoading.displayName = "InlineLoading";

// ============================================================================
// Progress Bar
// ============================================================================

export interface ProgressBarProps {
  value: number; // 0-100
  max?: number;
  label?: string;
  showPercentage?: boolean;
  size?: "sm" | "md" | "lg";
  color?: "primary" | "success" | "warning" | "danger";
}

export const ProgressBar = memo(
  ({
    value,
    max = 100,
    label,
    showPercentage = true,
    size = "md",
    color = "primary",
  }: ProgressBarProps) => {
    const percentage = Math.min(100, Math.max(0, (value / max) * 100));

    const sizeClasses = {
      sm: "h-1",
      md: "h-2",
      lg: "h-3",
    };

    const colorClasses = {
      primary: "bg-accent",
      success: "bg-emerald-400",
      warning: "bg-amber-400",
      danger: "bg-rose-400",
    };

    return (
      <div className="w-full">
        {(label || showPercentage) && (
          <div className="flex items-center justify-between mb-2">
            {label && <span className="text-xs text-white/60">{label}</span>}
            {showPercentage && (
              <span className="text-xs font-medium text-white">
                {Math.round(percentage)}%
              </span>
            )}
          </div>
        )}
        <div className={`w-full rounded-full bg-white/10 ${sizeClasses[size]}`}>
          <div
            className={`${sizeClasses[size]} rounded-full ${colorClasses[color]} transition-all duration-300 ease-out`}
            style={{ width: `${percentage}%` }}
            role="progressbar"
            aria-valuenow={value}
            aria-valuemin={0}
            aria-valuemax={max}
            aria-label={label}
          />
        </div>
      </div>
    );
  },
);
ProgressBar.displayName = "ProgressBar";
