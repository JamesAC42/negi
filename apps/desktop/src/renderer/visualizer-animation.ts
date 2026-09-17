/** Animate only while a surface is visible and its draw callback has work. */
export function createVisualizerAnimation(element: HTMLElement, draw: (now: number) => boolean) {
  let frame = 0;
  let disposed = false;
  let intersecting = false;
  const tick = (now: number) => {
    frame = 0;
    if (!disposed && intersecting && !document.hidden && draw(now)) invalidate();
  };
  function invalidate() {
    if (!disposed && intersecting && !document.hidden && !frame) frame = requestAnimationFrame(tick);
  }
  function visibility() {
    if (document.hidden || !intersecting) { cancelAnimationFrame(frame); frame = 0; }
    else invalidate();
  }
  const observer = new IntersectionObserver(entries => {
    intersecting = entries.some(entry => entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0);
    visibility();
  });
  observer.observe(element);
  document.addEventListener('visibilitychange', visibility);
  return {
    invalidate,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
    }
  };
}
