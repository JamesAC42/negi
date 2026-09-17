import assert from "node:assert/strict";

// Real queue warmer, palette hook and modal; all artwork/API requests are fixtures.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const origin = process.env.MUSIC_OS_RENDERER_ORIGIN ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-features=LocalNetworkAccessChecks"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], requests = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/src/renderer/ui/App.tsx*", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() +
      "\nexport { useQueuedArtworkVisualizerPalettes, useArtworkVisualizerPalette, prepareArtworkVisualizerPalette, artworkVisualizerPaletteCache, getCanvasThemeColors };" });
  });
  let failOnce = true;
  await page.route("http://127.0.0.1:47831/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/artwork/file/")) {
      const id = path.split("/").at(-1);
      requests.push(id);
      if (id === "retry" && failOnce) {
        failOnce = false;
        return route.fulfill({ status: 503, body: "temporary" });
      }
      if (id === "blue" || id === "stale") await new Promise(resolve => setTimeout(resolve, 350));
      const color = id.startsWith("red") ? "#dd2222" : id === "blue" ? "#2255dd" : "#22bb55";
      return route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="${color}" d="M0 0h32v32H0z"/></svg>` });
    }
    // No requests ever reach the live playback/library API.
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.route(`${origin}/__queue_palette_smoke`, route => route.fulfill({ contentType: "text/html", body: `<!doctype html>
    <style>body{margin:0}.nowPlayingOverlay{--bg0:#111;--acc:#aaaaaa}canvas{width:200px;height:60px}</style>
    <div id="fixture"></div><script type="module">
      import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
      const React=(await import('/node_modules/.vite/deps/react.js')).default;
      const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
      const {flushSync}=(await import('/node_modules/.vite/deps/react-dom.js')).default;
      const api=await import('/src/renderer/ui/App.tsx');
      window.api=api;
      window.files=['red1','red2','blue','green','stale'].map(id=>({
        id,path:'/fixture/'+id+'.flac',filename:id+'.flac',extension:'flac',sizeBytes:1024,durationMs:180000,
        displayTags:{title:id,artist:'Fixture',album:id.startsWith('red')?'Red':id,tracknumber:'1'},
        tags:{},rating:null,favoriteStatus:'neutral',playCount:0,lastPlayedAt:null
      }));
      window.playback={status:'playing',currentFileId:'red1',currentDisplayName:'red1',queue:['red1','red2','blue','green'],
        queueIndex:0,repeatMode:'none',positionMs:0,durationMs:180000,volume:80};
      window.mode='dark'; window.open=false; window.probeSrc=null;
      const noop=async()=>{};
      const root=createRoot(document.querySelector('#fixture'));
      function Probe(){
        const palette=api.useArtworkVisualizerPalette(window.probeSrc,window.mode);
        return React.createElement('output',{id:'probe','data-color':palette?.acc??''});
      }
      function Harness(){
        api.useQueuedArtworkVisualizerPalettes(window.playback,window.files,window.mode);
        return React.createElement(React.Fragment,null,React.createElement(Probe),window.open?React.createElement(api.NowPlayingModal,{
          appearanceMode:window.mode,files:window.files,playback:window.playback,playbackBusy:false,
          onRecordPlayerAction:noop,onRecordPlayerPresence:noop,onStop:noop,onClose:noop,onFavoriteStatus:noop,
          onNext:noop,onPauseResume:noop,onPlayFile:noop,onPrevious:noop,onRating:noop,onReplaceUpNext:noop,
          onRepeatMode:noop,onSaveQueue:noop,onSeek:noop,onOpenAlbumPage:noop,onOpenArtistPage:noop,onVolumeChange:noop,
          visualizerFrameRef:{current:null},waveformState:{status:'idle'}
        }):null);
      }
      window.render=()=>flushSync(()=>root.render(React.createElement(Harness)));
      window.color=()=>document.querySelector('.nowPlayingOverlay')?.style.getPropertyValue('--acc');
      window.cacheColor=(id,mode=window.mode)=>api.artworkVisualizerPaletteCache.get(mode+':http://127.0.0.1:47831/artwork/file/'+id)?.acc;
      window.switchTo=(id,index)=>{window.playback={...window.playback,currentFileId:id,queueIndex:index};window.render();return window.color()};
      window.render();window.ready=true;
    </script>` }));
  await page.goto(`${origin}/__queue_palette_smoke`);
  await page.waitForFunction(() => window.ready && window.cacheColor("blue"));
  assert.equal(await page.evaluate(() => window.open), false);
  assert.deepEqual(requests.slice().sort(), ["blue", "red1", "red2"], "warm current, immediate next and first next-album track while modal is closed");

  const warm = await page.evaluate(() => {
    window.open = true; window.render();
    return { actual: window.color(), expected: window.cacheColor("red1") };
  });
  assert.equal(warm.actual, warm.expected, "opening uses a prepared palette on its first render");
  const handoff = await page.evaluate(() => {
    const canvas = document.querySelector(".nowPlayingOverlay canvas");
    const before = window.api.getCanvasThemeColors(canvas).accent;
    const expected = window.cacheColor("blue");
    const actual = window.switchTo("blue", 2);
    const after = window.api.getCanvasThemeColors(canvas).accent;
    return { before, after, expected, actual };
  });
  assert.equal(handoff.actual, handoff.expected, "track-change render uses next album color immediately");
  assert.notDeepEqual(handoff.after, handoff.before, "canvas color cache is invalidated in the same commit");
  assert.equal(requests.filter(id => id === "blue").length, 1, "prefetch and visible playback share extraction/artwork");

  await page.waitForFunction(() => window.cacheColor("green"));
  await page.evaluate(() => {
    window.playback = { ...window.playback, queue: ["blue", "red1", "green"], queueIndex: 0 };
    window.render();
  });
  assert.equal(await page.evaluate(() => window.switchTo("red1", 1)), warm.expected, "reordered queue uses the selected track's prepared color");
  await page.evaluate(() => { window.mode = "light"; window.render(); });
  await page.waitForFunction(() => window.cacheColor("green", "light") && window.cacheColor("red1", "light"));
  const light = await page.evaluate(() => ({ actual: window.switchTo("green", 2), expected: window.cacheColor("green", "light") }));
  assert.equal(light.actual, light.expected, "lookahead is keyed by appearance mode");

  await page.evaluate(() => {
    window.mode = "dark";
    window.playback = { ...window.playback, currentFileId: "green", queue: ["wrap", "green"], queueIndex: 1, repeatMode: "queue" };
    window.render();
    window.probeSrc = "http://127.0.0.1:47831/artwork/file/stale"; window.render();
    window.probeSrc = "http://127.0.0.1:47831/artwork/file/blue"; window.render();
  });
  await page.waitForFunction(() => window.cacheColor("wrap"));
  assert.equal(requests.filter(id => id === "wrap").length, 1, "repeat queue warms its wrapped successor");
  await page.waitForTimeout(450);
  assert.equal(await page.locator("#probe").getAttribute("data-color"), handoff.expected, "late extraction never overwrites the current track");
  await page.evaluate(async () => {
    const url = "http://127.0.0.1:47831/artwork/file/retry";
    await window.api.prepareArtworkVisualizerPalette(url, "dark").catch(() => {});
    await window.api.prepareArtworkVisualizerPalette(url, "dark");
  });
  assert.equal(requests.filter(id => id === "retry").length, 2, "failed warmups can retry");
  await page.evaluate(() => { window.open = false; window.probeSrc = null; window.render(); });
  assert.equal(await page.locator("#probe").getAttribute("data-color"), "", "no artwork clears the previous palette");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, firstRenderPalette: handoff.actual, instantCanvasRefresh: true, closedModalLookahead: true }));
} finally {
  await browser.close();
}
