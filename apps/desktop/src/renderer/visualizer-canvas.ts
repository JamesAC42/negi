export type VisualizerCanvas = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  ratio: number;
  prepare(): void;
  dispose(): void;
};

/** Keep layout reads out of the audio visualizers' animation-frame callbacks. */
export function createVisualizerCanvas(canvas: HTMLCanvasElement, onResize?: () => void): VisualizerCanvas {
  const context = canvas.getContext("2d")!;
  const surface: VisualizerCanvas = {
    canvas, context, width: canvas.clientWidth, height: canvas.clientHeight, ratio: 1,
    prepare() {
      surface.ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.floor(surface.width * surface.ratio));
      const height = Math.max(1, Math.floor(surface.height * surface.ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.setTransform(surface.ratio, 0, 0, surface.ratio, 0, 0);
    },
    dispose() { observer.disconnect(); }
  };
  const observer = new ResizeObserver(() => {
    // client dimensions include padding and ignore entrance transforms. Read
    // them only when layout changes, never in a visualizer's drawing loop.
    surface.width = canvas.clientWidth;
    surface.height = canvas.clientHeight;
    surface.prepare();
    onResize?.();
  });
  observer.observe(canvas);
  surface.prepare();
  return surface;
}
