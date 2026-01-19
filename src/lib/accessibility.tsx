"use client";

import { useEffect, useRef, type ReactNode } from "react";

// ============================================================================
// ARIA Live Region Hook
// ============================================================================

/**
 * Hook to announce messages to screen readers
 */
export function useAnnouncement() {
  const announce = (
    message: string,
    priority: "polite" | "assertive" = "polite",
  ) => {
    const element = document.createElement("div");
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", priority);
    element.className = "sr-only";
    element.textContent = message;

    document.body.appendChild(element);

    // Remove after announcement
    setTimeout(() => {
      document.body.removeChild(element);
    }, 1000);
  };

  return { announce };
}

// ============================================================================
// Focus Trap Hook
// ============================================================================

/**
 * Hook to trap focus within a container (for modals, dialogs)
 */
export function useFocusTrap(enabled: boolean) {
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    const container = containerRef.current;
    const focusableElements = container.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );

    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[
      focusableElements.length - 1
    ] as HTMLElement;

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    // Focus first element
    firstElement?.focus();

    document.addEventListener("keydown", handleTabKey);

    return () => {
      document.removeEventListener("keydown", handleTabKey);
    };
  }, [enabled]);

  return containerRef;
}

// ============================================================================
// Focus Management Utilities
// ============================================================================

/**
 * Restore focus to previously focused element
 */
export function useFocusRestoration(enabled: boolean) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!enabled) return;

    // Store current focus
    previousFocusRef.current = document.activeElement as HTMLElement;

    return () => {
      // Restore focus on cleanup
      previousFocusRef.current?.focus();
    };
  }, [enabled]);
}

/**
 * Auto-focus ref on mount
 */
export function useAutoFocus<T extends HTMLElement>(
  enabled = true,
  options?: FocusOptions,
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (enabled && ref.current) {
      ref.current.focus(options);
    }
  }, [enabled, options]);

  return ref;
}

// ============================================================================
// Keyboard Navigation Hook
// ============================================================================

export interface KeyboardNavigationConfig {
  onSelect?: (element: HTMLElement) => void;
  onCancel?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  orientation?: "horizontal" | "vertical" | "both";
  loop?: boolean;
}

/**
 * Hook for keyboard navigation in lists/grids
 */
export function useKeyboardNavigation(
  items: Array<{ id: string }>,
  selectedIndex: number,
  setSelectedIndex: (index: number) => void,
  config: KeyboardNavigationConfig = {},
) {
  const { onSelect, onCancel, orientation = "vertical", loop = true } = config;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        if (orientation === "vertical" || orientation === "both") {
          e.preventDefault();
          const nextIndex =
            selectedIndex < items.length - 1
              ? selectedIndex + 1
              : loop
                ? 0
                : selectedIndex;
          setSelectedIndex(nextIndex);
        }
        break;

      case "ArrowUp":
        if (orientation === "vertical" || orientation === "both") {
          e.preventDefault();
          const prevIndex =
            selectedIndex > 0
              ? selectedIndex - 1
              : loop
                ? items.length - 1
                : selectedIndex;
          setSelectedIndex(prevIndex);
        }
        break;

      case "ArrowRight":
        if (orientation === "horizontal" || orientation === "both") {
          e.preventDefault();
          const nextIndex =
            selectedIndex < items.length - 1
              ? selectedIndex + 1
              : loop
                ? 0
                : selectedIndex;
          setSelectedIndex(nextIndex);
        }
        break;

      case "ArrowLeft":
        if (orientation === "horizontal" || orientation === "both") {
          e.preventDefault();
          const prevIndex =
            selectedIndex > 0
              ? selectedIndex - 1
              : loop
                ? items.length - 1
                : selectedIndex;
          setSelectedIndex(prevIndex);
        }
        break;

      case "Enter":
      case " ":
        e.preventDefault();
        const element = document.getElementById(
          `item-${items[selectedIndex]?.id}`,
        );
        onSelect?.(element as HTMLElement);
        break;

      case "Escape":
        e.preventDefault();
        onCancel?.();
        break;
    }
  };

  return { handleKeyDown };
}

// ============================================================================
// Screen Reader Only Component
// ============================================================================

export interface SrOnlyProps {
  children: ReactNode;
}

/**
 * Visually hidden but accessible to screen readers
 */
export function SrOnly({ children }: SrOnlyProps) {
  return (
    <span
      className="sr-only"
      style={{
        position: "absolute",
        width: "1px",
        height: "1px",
        padding: 0,
        margin: "-1px",
        overflow: "hidden",
        clip: "rect(0, 0, 0, 0)",
        whiteSpace: "nowrap",
        borderWidth: 0,
      }}
    >
      {children}
    </span>
  );
}
