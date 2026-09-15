/** One motion language for the independent Now Playing surfaces. */
const surfaces = [
  { selector: ".nowPlayingArtShell", x: -44, y: 16, settle: 0 },
  { selector: ".nowPlayingModalInfo", x: 36, y: -12, settle: 10 },
  { selector: ".nowPlayingControlDeck", x: 0, y: 34, settle: 17 },
  { selector: ".nowPlayingQueue", x: 52, y: 0, settle: 22 },
  { selector: ".waveformRibbon", x: 0, y: -26, settle: 7 },
  { selector: ".meterRail.left", x: -28, y: 0, settle: 15 },
  { selector: ".meterRail.right", x: 28, y: 0, settle: 20 },
  { selector: ".focusSpectrum", x: 24, y: 14, settle: 25 },
  { selector: ".spectrogramFloor", x: 0, y: 30, settle: 30 }
] as const;

export type NowPlayingMotion = { close(onClosed: () => void): void; dispose(): void };

export function createNowPlayingMotion(backdrop: HTMLElement): NowPlayingMotion {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const distance = window.matchMedia("(max-width: 980px)").matches ? 0.55 : 1;
  const parts = surfaces.flatMap((surface) => {
    const element = backdrop.querySelector<HTMLElement>(surface.selector);
    return element ? [{ ...surface, element }] : [];
  });
  let animations: Animation[] = [];
  let closing = false;
  let restoreScrollbars: (() => void) | null = null;

  function lockScrollbars(): void {
    if (restoreScrollbars) return;
    const restore = Array.from(backdrop.querySelectorAll<HTMLElement>(
      ".nowPlayingOverlay, .nowPlayingCockpit, .nowPlayingFocus"
    ), (element) => {
      const style = getComputedStyle(element);
      const hasVerticalGutter = element.offsetWidth - element.clientWidth
        - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth) > 0;
      const properties = ["overflow-x", "overflow-y", "scrollbar-gutter"];
      const previous = properties.map((name) => [name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name)]);
      // Reserve only an existing scrollbar's space. Hiding transient overflow must
      // neither shrink the content nor widen a scrollable panel for a single frame.
      if (hasVerticalGutter) element.style.setProperty("scrollbar-gutter", "stable");
      element.style.setProperty("overflow-x", "hidden");
      element.style.setProperty("overflow-y", "hidden");
      return () => previous.forEach(([name, value, priority]) => {
        if (value) element.style.setProperty(name, value, priority);
        else element.style.removeProperty(name);
      });
    });
    restoreScrollbars = () => { restore.forEach((restore) => restore()); restoreScrollbars = null; };
  }
  let disposed = false;
  const canAnimate = typeof backdrop.animate === "function";

  function cancelAnimations(): void {
    animations.forEach((animation) => animation.cancel());
    animations = [];
  }

  if (!reduced.matches && canAnimate) {
    lockScrollbars();
    animations.push(backdrop.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 35, easing: "ease-out", fill: "backwards"
    }));
    for (const { element, x, y, settle } of parts) {
      // Translate independently of layout centering, with no scaling or overshoot.
      // Every part starts immediately; slightly different durations stagger the settle.
      animations.push(element.animate([
        { opacity: 0, translate: `${x * distance}px ${y * distance}px` },
        { opacity: 1, translate: "0px 0px" }
      ], { duration: 220 + settle, easing: "cubic-bezier(0.12, 0.9, 0.2, 1)", fill: "backwards" }));
    }
    void Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))).then(() => {
      if (!closing && !disposed) restoreScrollbars?.();
    });
  }

  function onMotionPreferenceChange(): void {
    if (!reduced.matches) return;
    // Finish an in-flight close too, so changing the OS preference never strands the modal.
    animations.forEach((animation) => animation.finish());
  }
  reduced.addEventListener("change", onMotionPreferenceChange);

  return {
    close(onClosed) {
      if (closing || disposed) return;
      closing = true;
      backdrop.querySelector<HTMLElement>(".nowPlayingOverlay")?.setAttribute("inert", "");
      if (reduced.matches || !canAnimate) {
        cancelAnimations();
        restoreScrollbars?.();
        onClosed();
        return;
      }
      lockScrollbars();
      // Sample before cancelling: Escape during entry leaves from the visible pose.
      const opacity = getComputedStyle(backdrop).opacity;
      const snapshots = parts.map(({ element }) => {
        const style = getComputedStyle(element);
        return { opacity: style.opacity, translate: style.translate };
      });
      cancelAnimations();
      parts.forEach(({ element, x, y }, index) => {
        animations.push(element.animate([
          snapshots[index],
          { opacity: 0, translate: `${x * distance * 0.65}px ${y * distance * 0.65}px` }
        ], { duration: 130, easing: "cubic-bezier(0.16, 0.8, 0.3, 1)", fill: "both" }));
      });
      animations.push(backdrop.animate([{ opacity }, { opacity: 0 }], {
        duration: 140, easing: "linear", fill: "both"
      }));
      void Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))).then(() => {
        if (!disposed) onClosed();
      });
    },
    dispose() {
      disposed = true;
      reduced.removeEventListener("change", onMotionPreferenceChange);
      cancelAnimations();
      restoreScrollbars?.();
    }
  };
}
