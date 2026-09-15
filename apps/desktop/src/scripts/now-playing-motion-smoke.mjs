import assert from "node:assert/strict";

// Use an existing Playwright installation; this test never opens the live app or calls its API.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const origin = process.env.MUSIC_OS_RENDERER_ORIGIN ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-features=LocalNetworkAccessChecks"] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(`${origin}/__now_playing_motion_smoke`, (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><style>
      .nowPlayingOverlay { width: 300px; height: 180px; overflow: auto; }
      .nowPlayingFocus { width: 100%; height: 180px; overflow: auto; }
      .nowPlayingArtShell { width: 100%; height: 180px; }
      .waveformRibbon { position: absolute; }
    </style><div id="fixture"></div><script type="module">
      const { createNowPlayingMotion } = await import('/src/renderer/now-playing-motion.ts');
      window.mount = (overflow = false) => {
        document.querySelector('#fixture').innerHTML = '<div class="nowPlayingBackdrop"><section class="nowPlayingOverlay"><div class="nowPlayingFocus"><div class="nowPlayingArtShell"></div><div class="nowPlayingModalInfo"></div></div><div class="nowPlayingQueue"></div><div class="waveformRibbon" style="transform:translateX(-50%);width:200px"></div></section></div>';
        window.backdrop = document.querySelector('.nowPlayingBackdrop');
        window.motionCloseCount = 0;
        if (overflow) document.querySelector('.nowPlayingArtShell').style.height = '360px';
        window.scrollSizes = () => [...window.backdrop.querySelectorAll('.nowPlayingOverlay, .nowPlayingFocus')].map(el => ({width: el.clientWidth, height: el.clientHeight}));
        window.beforeMotionSizes = window.scrollSizes();
        window.motion = createNowPlayingMotion(window.backdrop);
      };
      window.mount();
    </script>`
  }));
  await page.goto(`${origin}/__now_playing_motion_smoke`);
  await page.waitForFunction(() => window.motion);
  // Test both a snug panel and an already scrollable one with its existing gutter.
  for (const overflow of [false, true]) {
    const result = await page.evaluate(async (overflow) => {
      window.motion.dispose(); window.mount(overflow);
      const animations = window.backdrop.getAnimations({ subtree: true });
      animations.forEach(a => a.pause());
      const frames = [];
      for (const time of [0, 16, 40, 100, 200]) {
        animations.forEach(a => a.currentTime = time);
        frames.push({time, sizes: window.scrollSizes(),
          scrollbars: [...window.backdrop.querySelectorAll('.nowPlayingOverlay, .nowPlayingFocus')].map(el => getComputedStyle(el).overflowY),
          scale: getComputedStyle(document.querySelector('.nowPlayingArtShell')).scale,
          translate: getComputedStyle(document.querySelector('.nowPlayingArtShell')).translate});
      }
      animations.forEach(a => a.finish());
      await Promise.all(animations.map(a => a.finished));
      await Promise.resolve();
      return {before: window.beforeMotionSizes, frames, after: window.scrollSizes(),
        restored: [...window.backdrop.querySelectorAll('.nowPlayingOverlay, .nowPlayingFocus')].map(el => getComputedStyle(el).overflowY)};
    }, overflow);
    for (const frame of result.frames) {
      assert.deepEqual(frame.sizes, result.before, "scrollbar allocation must not resize panel contents during motion");
      assert.ok(frame.scrollbars.every(value => value === "hidden"), "transient overflow cannot show scrollbars");
      assert.equal(frame.scale, "none", "panel dimensions stay fixed");
    }
    assert.deepEqual(result.after, result.before, "restoring scrolling must not resize content");
    assert.ok(result.restored.every(value => value === "auto"), "normal scrolling returns after entry");
    const startX = parseFloat(result.frames[0].translate);
    const firstX = parseFloat(result.frames[1].translate);
    assert.ok(Math.abs(firstX) < Math.abs(startX) * 0.8, "entrance makes visible progress in its first frame");
  }
  await page.evaluate(() => { window.motion.dispose(); window.mount(); });
  const interruption = await page.evaluate(async () => {
    const art = document.querySelector(".nowPlayingArtShell");
    const read = () => {
      const s = getComputedStyle(art);
      return { opacity: s.opacity, translate: s.translate, rotate: s.rotate, scale: s.scale };
    };
    window.backdrop.getAnimations({ subtree: true }).forEach((a) => { a.pause(); a.currentTime = 95; });
    const before = read();
    window.motion.close(() => window.motionCloseCount++);
    const after = read();
    const inert = document.querySelector(".nowPlayingOverlay").inert;
    const exitAnimations = window.backdrop.getAnimations({subtree: true});
    exitAnimations.forEach(a => { a.pause(); a.currentTime = 16; });
    const firstExitFrame = read();
    const exitBackdropOpacity = getComputedStyle(window.backdrop).opacity;
    exitAnimations.forEach(a => a.play());
    window.exitFirstFrame = { before, after: firstExitFrame, backdropOpacity: exitBackdropOpacity };
    window.motion.close(() => window.motionCloseCount++);
    await Promise.all(window.backdrop.getAnimations({ subtree: true }).map((a) => a.finished));
    await Promise.resolve();
    return { before, after, inert, closed: window.motionCloseCount };
  });
  assert.deepEqual(interruption.before, interruption.after, "exit begins at the interrupted visible pose");
  const exitFirstFrame = await page.evaluate(() => window.exitFirstFrame);
  assert.ok(Number(exitFirstFrame.after.opacity) < Number(exitFirstFrame.before.opacity) * 0.7, "exit starts fading in its first frame");
  assert.ok(Number(exitFirstFrame.backdropOpacity) < 1, "backdrop starts fading immediately");
  assert.equal(interruption.inert, true, "closing controls are inert");
  await page.waitForFunction(() => window.motionCloseCount === 1);
  assert.equal(await page.evaluate(() => window.motionCloseCount), 1, "repeated close requests complete once");

  await page.evaluate(() => { window.motion.dispose(); window.mount(); });
  await page.waitForFunction(() => window.backdrop.getAnimations({ subtree: true }).length === 0);
  const settled = await page.evaluate(() => ({
    translate: getComputedStyle(document.querySelector(".nowPlayingArtShell")).translate,
    scale: getComputedStyle(document.querySelector(".nowPlayingArtShell")).scale,
    waveform: getComputedStyle(document.querySelector(".waveformRibbon")).transform
  }));
  assert.equal(settled.translate, "none", "entrance releases translations");
  assert.equal(settled.scale, "none", "entrance releases scaling");
  assert.equal(settled.waveform, "matrix(1, 0, 0, 1, -100, 0)", "layout centering survives the entrance");

  await page.evaluate(() => { window.motion.close(() => window.motionCloseCount++); window.motion.dispose(); });
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.motionCloseCount), 0, "unmount cancels a pending close callback");

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reduced = await page.evaluate(() => {
    window.mount();
    const animations = window.backdrop.getAnimations({ subtree: true }).length;
    window.motion.close(() => window.motionCloseCount++);
    return { animations, closed: window.motionCloseCount };
  });
  assert.deepEqual(reduced, { animations: 0, closed: 1 }, "reduced motion has no movement or dismissal delay");

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => {
    window.motion.dispose(); window.mount();
    window.motion.close(() => window.motionCloseCount++);
    window.backdrop.getAnimations({ subtree: true }).forEach((a) => a.pause());
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => window.motionCloseCount === 1);
  assert.equal(await page.evaluate(() => window.motionCloseCount), 1, "changing motion preference completes an in-flight close");

  await page.evaluate(() => window.motion.dispose());

  // Exercise the actual React scene lifecycle, replacing only costly GPU creation.
  await page.route("**/src/renderer/ui/turntable/turntable-engine.ts*", async route => {
    const response = await route.fetch();
    let body = await response.text();
    const constructor = "renderer = new THREE.WebGLRenderer(";
    assert.ok(body.includes(constructor), "scene initialization instrumentation remains valid");
    body = body.replace(constructor, `window.sceneStarts.push({ focused: latest.current.elapsed != null, movingFrames: window.sceneFrames.filter(opacity => opacity > 0.05).length }); throw new Error('isolated GPU fixture'); ${constructor}`);
    await route.fulfill({ response, body });
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(async () => {
    const RefreshRuntime = (await import('/@react-refresh')).default;
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const ReactDOMClient = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { createRoot } = ReactDOMClient.default ?? ReactDOMClient;
    const ReactDOM = await import('/node_modules/.vite/deps/react-dom.js');
    const { flushSync } = ReactDOM.default ?? ReactDOM;
    const { TurntableScene } = await import('/src/renderer/ui/turntable/TurntableScene.tsx');
    const { createNowPlayingMotion } = await import('/src/renderer/now-playing-motion.ts');
    window.mountScene = (elapsed) => {
      window.sceneStarts = []; window.sceneFrames = [];
      const host = document.querySelector('#fixture');
      host.innerHTML = '';
      window.sceneRoot = createRoot(host);
      function Harness() {
        const ref = React.useRef(null);
        React.useLayoutEffect(() => {
          const motion = createNowPlayingMotion(ref.current);
          let frame = 0;
          const sample = () => {
            window.sceneFrames.push(Number(getComputedStyle(ref.current.querySelector('.nowPlayingArtShell')).opacity));
            frame = requestAnimationFrame(sample);
          };
          frame = requestAnimationFrame(sample);
          return () => { cancelAnimationFrame(frame); motion.dispose(); };
        }, []);
        return React.createElement('div', { className: 'nowPlayingBackdrop', ref },
          React.createElement('div', { className: 'nowPlayingArtShell' }),
          React.createElement(TurntableScene, { album: { fileId: '', album: 'Fixture', artist: 'Fixture' }, artworkUrl: () => '',
            playing: false, progress: 0, empty: true, layout: 'classic', elapsed }));
      }
      flushSync(() => window.sceneRoot.render(React.createElement(React.StrictMode, null, React.createElement(Harness))));
    };
    window.unmountScene = () => flushSync(() => window.sceneRoot.unmount());
    window.mountScene(undefined);
  });
  await page.waitForFunction(() => window.sceneStarts.length > 0);
  const inline = await page.evaluate(() => window.sceneStarts);
  assert.equal(inline.length, 1, "StrictMode does not duplicate deferred GPU setup");
  assert.ok(inline[0].movingFrames > 0, "entrance paints moving frames before inline GPU initialization");
  await page.evaluate(() => { window.unmountScene(); window.mountScene(undefined); window.unmountScene(); });
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => window.sceneStarts), [], "quick dismissal cancels deferred GPU initialization");
  const focused = await page.evaluate(() => {
    window.mountScene(0);
    const starts = window.sceneStarts.slice();
    window.unmountScene();
    return starts;
  });
  assert.ok(focused.length > 0 && focused.every(start => start.focused && start.movingFrames === 0), "record exchange scenes keep immediate initialization");
  assert.deepEqual(errors, []);
  console.log("PASS fixed panel dimensions, stable scrollbar gutters, immediate first-frame motion, interrupted entry continuity, close deduplication, inert controls, transform cleanup, waveform centering, unmount cancellation, reduced motion, live preference changes, first-paint GPU deferral, quick-dismiss cancellation, immediate record exchanges");
} finally {
  await browser.close();
}
