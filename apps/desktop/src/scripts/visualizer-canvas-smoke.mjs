import assert from "node:assert/strict";

// Isolated canvas fixture: no backend requests or playback changes.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const origin = process.env.MUSIC_OS_RENDERER_ORIGIN ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-features=LocalNetworkAccessChecks"] });
try {
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.route(`${origin}/__visualizer_canvas_smoke`, route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><style>
      #host { width: 320px; height: 180px; }
      canvas { width: 100%; height: 100%; padding: 8px; box-sizing: border-box; }
    </style><div id="host"><canvas></canvas></div><script type="module">
      import { createVisualizerCanvas } from '/src/renderer/visualizer-canvas.ts';
      const canvas = document.querySelector('canvas');
      window.layoutReads = 0;
      for (const property of ['clientWidth', 'clientHeight']) {
        const get = Object.getOwnPropertyDescriptor(Element.prototype, property).get;
        Object.defineProperty(canvas, property, { get() { window.layoutReads++; return get.call(this); } });
      }
      window.surface = createVisualizerCanvas(canvas);
    </script>`
  }));
  await page.goto(`${origin}/__visualizer_canvas_smoke`);
  await page.waitForFunction(() => window.surface);
  const stable = await page.evaluate(async () => {
    const { surface } = window;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    surface.context.fillStyle = '#ff0000';
    surface.context.fillRect(0, 0, surface.width, surface.height);
    const image = surface.canvas.toDataURL();
    const initial = { width: surface.canvas.width, height: surface.canvas.height };
    window.layoutReads = 0;
    const samples = [];
    const animation = document.querySelector('#host').animate([
      { transform: 'translateX(-44px) scale(.8)' }, { transform: 'translateX(0) scale(1)' }
    ], { duration: 120 });
    for (let i = 0; i < 16; i++) {
      await new Promise(requestAnimationFrame);
      surface.prepare();
      samples.push({ width: surface.canvas.width, height: surface.canvas.height });
    }
    await animation.finished;
    return { initial, samples, reads: window.layoutReads, preserved: surface.canvas.toDataURL() === image };
  });
  assert.deepEqual(stable.initial, { width: 640, height: 360 }, 'backing buffer retains padded layout size and pixel density');
  assert.ok(stable.samples.every(sample => sample.width === 640 && sample.height === 360), 'entry transforms never resize the backing buffer');
  assert.equal(stable.reads, 0, 'steady drawing and entrance motion do not measure layout');
  assert.equal(stable.preserved, true, 'preparing a paused canvas preserves its spectrogram history');

  await page.evaluate(() => { document.querySelector('#host').style.width = '470px'; });
  await page.waitForFunction(() => window.surface.canvas.width === 940);
  assert.equal(await page.evaluate(() => window.surface.width), 470, 'actual layout changes update cached dimensions');
  const density = await page.evaluate(() => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
    window.surface.prepare();
    const normal = window.surface.canvas.width;
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 3 });
    window.surface.prepare();
    return { normal, capped: window.surface.canvas.width };
  });
  assert.deepEqual(density, { normal: 470, capped: 940 }, 'moving between display densities updates buffers and keeps the existing 2x cap');
  const disposed = await page.evaluate(async () => {
    window.surface.dispose();
    window.layoutReads = 0;
    document.querySelector('#host').style.width = '510px';
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { width: window.surface.canvas.width, reads: window.layoutReads };
  });
  assert.deepEqual(disposed, { width: 940, reads: 0 }, 'unmount disconnects sizing work');
  console.log(JSON.stringify({ ok: true, drawingLayoutReads: stable.reads, historyPreserved: stable.preserved }));
} finally {
  await browser.close();
}
