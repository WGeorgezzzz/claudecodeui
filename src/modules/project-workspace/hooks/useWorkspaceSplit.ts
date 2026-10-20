import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

const STORAGE_KEY = 'claude-workspace-panel-percent';
const clamp = (value: number) => Math.min(70, Math.max(30, value));

/** Used by WorkspaceMain for an accessible, persistent tool-panel divider. */
export function useWorkspaceSplit() {
  const containerRef = useRef<HTMLDivElement>(null);
  // Keep the chosen tool-panel width when switching tabs or reopening the app.
  const [percent, setPercent] = useState(() => {
    const stored = Number(localStorage.getItem(STORAGE_KEY) || '50');
    return Number.isFinite(stored) ? clamp(stored) : 50;
  });
  const update = (value: number) => {
    const next = clamp(value);
    setPercent(next);
    localStorage.setItem(STORAGE_KEY, String(next));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const bounds = containerRef.current?.getBoundingClientRect();
    if (bounds && bounds.width > 0) update((bounds.right - event.clientX) / bounds.width * 100);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    update(event.key === 'Home' ? 30 : event.key === 'End' ? 70
      : percent + (event.key === 'ArrowLeft' ? 5 : -5));
  };
  return {
    containerRef, percent,
    separatorProps: {
      role: 'separator' as const, tabIndex: 0,
      'aria-orientation': 'vertical' as const,
      'aria-valuemin': 30, 'aria-valuemax': 70, 'aria-valuenow': Math.round(percent),
      onKeyDown, onPointerMove,
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      },
      onDoubleClick: () => update(50),
    },
  };
}
