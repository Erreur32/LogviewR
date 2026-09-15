import { useEffect, useRef, useState } from 'react';

/** Tracks an element's content-box width via ResizeObserver, debounced to rAF and a 2px threshold. */
export function useContainerWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
    const ref = useRef<T>(null);
    const [width, setWidth] = useState(0);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        let rafId = 0;
        const applyWidth = (w: number) => setWidth((prev) => (Math.abs(prev - w) >= 2 ? w : prev));
        const scheduleWidth = (w: number) => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => applyWidth(w));
        };
        const ro = new ResizeObserver((entries) => scheduleWidth(entries[0]?.contentRect.width ?? 0));
        ro.observe(el);
        return () => {
            if (rafId) cancelAnimationFrame(rafId);
            ro.disconnect();
        };
    }, []);

    return [ref, width];
}
