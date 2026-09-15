import assert from 'node:assert/strict';

// Real WebGL scene with isolated UI/clock instrumentation; never mounts the app or controls playback.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const origin = process.env.MUSIC_OS_RENDERER_ORIGIN ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
  args: ['--no-sandbox', '--disable-features=LocalNetworkAccessChecks'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/renderer/ui/turntable/turntable-engine.ts*', async route => {
    const response = await route.fetch();
    let body = await response.text();
    for (const [source, replacement] of [
      ['renderer = new THREE.WebGLRenderer(', 'window.sceneCreations++; renderer = new THREE.WebGLRenderer('],
      ['renderer.render(root, camera);', 'window.sceneDraws++; window.lastSceneProps = { album: p.album.album, progress: p.progress, layout: p.layout }; renderer.render(root, camera);'],
      ['renderer.dispose();', 'window.sceneDisposals++; renderer.dispose();']
    ]) {
      assert.ok(body.includes(source), `scene instrumentation remains valid: ${source}`);
      body = body.replace(source, replacement);
    }
    await route.fulfill({ response, body });
  });
  await page.route(`${origin}/__turntable_cache_smoke`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <style>.turntableScene{width:360px;height:233px}.turntableScene canvas{width:100%;height:100%}</style><div id="fixture"></div>
    <script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;
      window.__vite_plugin_react_preamble_installed__=true;
      window.sceneCreations=0; window.sceneDraws=0; window.sceneDisposals=0;
      const pending=new Map(), schedule=window.setTimeout.bind(window), cancel=window.clearTimeout.bind(window);
      window.setTimeout=(callback,ms,...args)=>{
        const id=schedule(callback,ms,...args);
        if(ms===30000)pending.set(id,()=>{window.clearTimeout(id);callback(...args)});
        return id;
      };
      window.clearTimeout=id=>{pending.delete(id);cancel(id)};
      window.expireWarmScene=()=>{if(pending.size!==1)throw Error('Expected one 30-second cache expiry'); [...pending.values()][0]()};
      const React=(await import('/node_modules/.vite/deps/react.js')).default;
      const domClient=await import('/node_modules/.vite/deps/react-dom_client.js');
      const {createRoot}=domClient.default??domClient;
      const dom=await import('/node_modules/.vite/deps/react-dom.js'); const {flushSync}=dom.default??dom;
      const {TurntableScene}=await import('/src/renderer/ui/turntable/TurntableScene.tsx');
      window.renderScene=(overrides={})=>{
        window.sceneRoot=createRoot(document.querySelector('#fixture'));
        const props={album:{fileId:'',album:'Cache fixture',artist:'Fixture'},artworkUrl:()=>'',playing:true,progress:.4,layout:'classic',...overrides};
        const beforeDraws=window.sceneDraws, beforeCreations=window.sceneCreations;
        const started=performance.now();
        flushSync(()=>window.sceneRoot.render(React.createElement(React.StrictMode,null,React.createElement(TurntableScene,props))));
        return {canvas:!!document.querySelector('canvas'),sameCanvas:document.querySelector('canvas')===window.originalCanvas,
          newScenes:window.sceneCreations-beforeCreations,draws:window.sceneDraws-beforeDraws,elapsed:performance.now()-started};
      };
      window.removeScene=()=>flushSync(()=>window.sceneRoot.unmount());
      window.ready=true;
    </script>` }));
  await page.goto(`${origin}/__turntable_cache_smoke`);
  await page.waitForFunction(() => window.ready);
  const cold = await page.evaluate(() => window.renderScene());
  assert.equal(cold.canvas, false, 'first opening keeps initialization off the entrance frame');
  await page.waitForFunction(() => window.sceneDraws > 1);
  assert.equal(await page.evaluate(() => window.sceneCreations), 1, 'cold StrictMode mount creates one deferred scene');
  const parked = await page.evaluate(() => {
    window.originalCanvas = document.querySelector('canvas');
    window.removeScene();
    return { draws: window.sceneDraws, disposed: window.sceneDisposals, connected: window.originalCanvas.isConnected };
  });
  assert.equal(parked.connected, false, 'closing detaches the scene from the document');
  assert.equal(parked.disposed, 0, 'closing retains compiled GPU resources');
  await page.waitForTimeout(150);
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  assert.equal(await page.evaluate(() => window.sceneDraws), parked.draws, 'parked scene renders no frames, including on window resize');
  const reopens = [];
  for (let i = 0; i < 3; i++) {
    const reopened = await page.evaluate(() => window.renderScene());
    assert.equal(reopened.sameCanvas, true, 'quick reopening reuses the same WebGL canvas');
    assert.equal(reopened.newScenes, 0, 'warm reopening never rebuilds the GPU scene');
    assert.ok(reopened.draws > 0, 'warm scene draws synchronously before the reopening paint');
    reopens.push(reopened.elapsed);
    await page.evaluate(() => window.removeScene());
  }
  const updated = await page.evaluate(() => {
    const result = window.renderScene({ album: { fileId: '', album: 'Updated record', artist: 'Fixture' }, progress: .8, layout: 'gallery' });
    return { ...result, props: window.lastSceneProps };
  });
  assert.equal(updated.sameCanvas, true, 'reopening with updated playback still reuses the canvas');
  assert.deepEqual(updated.props, { album: 'Updated record', progress: .8, layout: 'gallery' }, 'first warm draw uses current album, progress, and layout');
  await page.evaluate(() => window.removeScene());
  await page.evaluate(() => window.renderScene({ elapsed: 0 }));
  assert.equal(await page.evaluate(() => document.querySelector('canvas') === window.originalCanvas), false, 'focused exchange uses an independent scene');
  await page.evaluate(() => window.removeScene());
  assert.equal((await page.evaluate(() => window.renderScene())).sameCanvas, true, 'focused exchange leaves the inline cache available');
  await page.evaluate(() => window.removeScene());
  const expired = await page.evaluate(() => {
    const before = window.sceneDisposals;
    window.expireWarmScene();
    return window.sceneDisposals - before;
  });
  assert.equal(expired, 1, 'expiry releases the retained GPU scene exactly once');
  assert.equal((await page.evaluate(() => window.renderScene())).canvas, false, 'expired scene takes the normal deferred initialization path');
  await page.waitForFunction(() => !!document.querySelector('canvas'));
  const invalid = await page.evaluate(() => {
    window.originalCanvas = document.querySelector('canvas');
    window.removeScene();
    window.originalCanvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    const before = window.sceneDisposals;
    const result = window.renderScene();
    return { ...result, disposed: window.sceneDisposals - before };
  });
  assert.equal(invalid.canvas, false, 'lost GPU contexts are never reused');
  await page.waitForFunction(() => !!document.querySelector('canvas'));
  assert.equal(await page.evaluate(() => document.querySelector('canvas') === window.originalCanvas), false, 'lost context is replaced by a fresh scene');
  await page.evaluate(() => { window.removeScene(); window.expireWarmScene(); });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, warmReopenMs: reopens, parkedFrames: 0, expiryDisposals: expired }));
} finally {
  await browser.close();
}
