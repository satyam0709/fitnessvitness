import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Scroll to list item matching ?highlight=ID and apply a temporary highlight class.
 * @param {string|null} highlightId - from useSearchParams().get("highlight")
 * @param {boolean} ready - true when list data has loaded
 * @param {string} highlightedClass - CSS module class name for outline
 * @param {{ beforeScroll?: (id: string) => void, idPrefix?: string }} [options]
 */
export function useListHighlight(highlightId, ready, highlightedClass, options = {}) {
  const [highlightedId, setHighlightedId] = useState(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const itemDomId = useCallback(
    (id) => `${optionsRef.current.idPrefix || "item"}-${id}`,
    []
  );

  const focusItem = useCallback(() => {
    if (!highlightId || !highlightedClass) return false;
    const el = document.getElementById(itemDomId(highlightId));
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedId(highlightId);
    window.setTimeout(() => setHighlightedId(null), 3000);
    return true;
  }, [highlightId, highlightedClass, itemDomId]);

  const scrollToHighlight = useCallback(() => {
    if (!highlightId || !highlightedClass) return false;
    const before = optionsRef.current.beforeScroll;
    if (before) {
      before(highlightId);
      window.setTimeout(() => focusItem(), 320);
      return true;
    }
    return focusItem();
  }, [highlightId, highlightedClass, focusItem]);

  useEffect(() => {
    if (!highlightId || !ready || !highlightedClass) return undefined;

    const timer = window.setTimeout(() => {
      scrollToHighlight();
    }, 100);

    return () => window.clearTimeout(timer);
  }, [highlightId, ready, highlightedClass, scrollToHighlight]);

  return { highlightedId, scrollToHighlight };
}

export function itemHighlightClass(id, highlightedId, highlightedClass) {
  if (!highlightedId || String(id) !== String(highlightedId)) return "";
  return highlightedClass || "";
}
