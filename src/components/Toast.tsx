"use client";

import { AlertCircle, CheckCircle, Info, X, AlertTriangle } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";

// ============================================================================
// Types
// ============================================================================

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastContextValue {
  toasts: Toast[];
  showToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
  clearAll: () => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

// ============================================================================
// Toast Provider
// ============================================================================

const DEFAULT_DURATIONS: Record<ToastType, number> = {
  success: 4000,
  error: 6000,
  info: 4000,
  warning: 5000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = Math.random().toString(36).slice(2);
      const newToast: Toast = {
        ...toast,
        id,
        duration: toast.duration ?? DEFAULT_DURATIONS[toast.type],
      };

      setToasts((prev) => [...prev, newToast]);

      // Auto-remove after duration
      if (newToast.duration && newToast.duration > 0) {
        setTimeout(() => {
          removeToast(id);
        }, newToast.duration);
      }
    },
    [removeToast],
  );

  const clearAll = useCallback(() => {
    setToasts([]);
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, showToast, removeToast, clearAll }}>
      {children}
      <ToastContainer />
    </ToastContext.Provider>
  );
}

// ============================================================================
// useToast Hook
// ============================================================================

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}

// ============================================================================
// Toast Icons
// ============================================================================

const ToastIcons = {
  success: (
    <CheckCircle className="h-5 w-5 text-emerald-400" aria-hidden="true" />
  ),
  error: <AlertCircle className="h-5 w-5 text-rose-400" aria-hidden="true" />,
  info: <Info className="h-5 w-5 text-blue-400" aria-hidden="true" />,
  warning: (
    <AlertTriangle className="h-5 w-5 text-amber-400" aria-hidden="true" />
  ),
};

// ============================================================================
// Toast Container
// ============================================================================

function ToastContainer() {
  const { toasts, removeToast } = useToast();

  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 sm:bottom-6 sm:right-6"
      role="region"
      aria-label="Toast notifications"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
      ))}
    </div>
  );
}

// ============================================================================
// Toast Item Component
// ============================================================================

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [isExiting, setIsExiting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    if (isPaused || !toast.duration) return;

    const interval = 16; // ~60fps
    const step = 100 / (toast.duration / interval);

    const timer = setInterval(() => {
      setProgress((prev) => {
        const next = prev - step;
        return next > 0 ? next : 0;
      });
    }, interval);

    return () => clearInterval(timer);
  }, [toast.duration, isPaused]);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => onDismiss(toast.id), 300);
  }, [toast.id, onDismiss]);

  const handleAction = useCallback(() => {
    toast.action?.onClick();
    handleDismiss();
  }, [toast, handleDismiss]);

  return (
    <div
      className={`glass glow-ring max-w-sm rounded-2xl border border-white/10 bg-black/80 p-4 shadow-xl transition-all duration-300 ${
        isExiting ? "opacity-0 translate-y-2" : "opacity-100 translate-y-0"
      }`}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      role="alert"
      aria-labelledby={`toast-title-${toast.id}`}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="flex-shrink-0 mt-0.5">{ToastIcons[toast.type]}</div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p
            id={`toast-title-${toast.id}`}
            className="text-sm font-semibold text-white"
          >
            {toast.title}
          </p>
          {toast.message && (
            <p className="mt-1 text-xs text-white/70">{toast.message}</p>
          )}

          {/* Action button */}
          {toast.action && (
            <button
              type="button"
              onClick={handleAction}
              className="mt-2 text-xs font-medium text-accent hover:text-accent/80 transition-colors"
            >
              {toast.action.label}
            </button>
          )}
        </div>

        {/* Dismiss button */}
        <button
          type="button"
          onClick={handleDismiss}
          className="flex-shrink-0 text-white/50 hover:text-white transition-colors rounded-lg p-0.5 hover:bg-white/10"
          aria-label="Dismiss notification"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Progress bar */}
      {toast.duration && toast.duration > 0 && (
        <div className="mt-3 h-0.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-white/30 transition-all ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Convenience Functions (use within components only)
// ============================================================================

/**
 * Show a success toast (must be called within a React component)
 * NOTE: Placeholder function - use the useToast hook directly
 */
export function toastSuccess(): void {
  console.warn("toastSuccess should be called through useToast hook");
}

/**
 * Show an error toast (must be called within a React component)
 * NOTE: Placeholder function - use the useToast hook directly
 */
export function toastError(): void {
  console.warn("toastError should be called through useToast hook");
}

/**
 * Show an info toast (must be called within a React component)
 * NOTE: Placeholder function - use the useToast hook directly
 */
export function toastInfo(): void {
  console.warn("toastInfo should be called through useToast hook");
}

/**
 * Show a warning toast (must be called within a React component)
 * NOTE: Placeholder function - use the useToast hook directly
 */
export function toastWarning(): void {
  console.warn("toastWarning should be called through useToast hook");
}
