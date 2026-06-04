import { useCallback, useEffect, useRef, useState } from "react";

import { scrollToSection } from "./sections";

export interface UseSettingsScrollSpyResult {
  activeSectionId: string;
  /** Click a TOC entry: locks the observer + smooth-scrolls to the section. */
  navigateTo: (id: string) => void;
}

/**
 * Scroll-spy for the Settings TOC. State-driven (clicks set the active id
 * directly); an IntersectionObserver acts as a passive observer that updates
 * state when the user scrolls manually. A short post-click "lock" window blocks
 * IO from overriding the click target while the smooth-scroll is in flight.
 */
export function useSettingsScrollSpy(
  sectionIds: ReadonlyArray<string>,
): UseSettingsScrollSpyResult {
  const [activeSectionId, setActiveSectionId] = useState<string>(
    sectionIds[0] ?? "",
  );
  const clickLockUntilRef = useRef<number>(0);

  useEffect(() => {
    const elements: HTMLElement[] = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    // We observe the section heading (`<h3 id=…>`). Headings are short
    // (~40 px), so the observation band starts at the viewport's very
    // top — otherwise scrolling exactly to a heading places it ABOVE
    // the band while the next heading falls INSIDE it, and the active
    // highlight jumps to the wrong (next) entry.
    //
    // rootMargin "0px 0px -85% 0px" → root collapses to the top 15 %
    // of the viewport. A heading is "intersecting" as soon as any part
    // of it is in that strip; mid-scroll multiple headings can be in
    // the band — picking the one with the lowest |top| reliably
    // surfaces the heading currently at the top of the viewport.
    const intersectingMap = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        // Ignore IO firings during a click-driven smooth-scroll — the
        // intermediate sections we pass through would briefly become
        // "active" otherwise, causing the highlight to flicker through
        // every section between the old and new targets.
        if (Date.now() < clickLockUntilRef.current) return;

        for (const entry of entries) {
          intersectingMap.set(entry.target.id, entry.isIntersecting);
        }
        const stillIntersecting = elements
          .map((el) => ({ id: el.id, top: el.getBoundingClientRect().top }))
          .filter((s) => intersectingMap.get(s.id) === true)
          .sort((a, b) => Math.abs(a.top) - Math.abs(b.top));
        const candidateId = stillIntersecting[0]?.id;
        if (!candidateId) return;
        setActiveSectionId(candidateId);
      },
      {
        rootMargin: "0px 0px -85% 0px",
        threshold: 0,
      },
    );
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
    // sectionIds is a module-level constant; observe once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigateTo = useCallback((id: string): void => {
    // Lock IO updates for ~700 ms so the smooth-scroll can finish
    // without the in-transit sections taking over the active state.
    clickLockUntilRef.current = Date.now() + 700;
    setActiveSectionId(id);
    scrollToSection(id);
  }, []);

  return { activeSectionId, navigateTo };
}
