import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import ts from "typescript";

// Compare real renderer code with the pre-pass waveform. No live API/playback calls.
const baseline = execFileSync("git", ["show", "8d2cad1:apps/desktop/src/renderer/ui/App.tsx"], { encoding: "utf8" });
const start = baseline.indexOf("function drawWaveform(");
const end = baseline.indexOf("function downsampleWaveformPeaks", start);
const reference = ts.transpile(baseline.slice(start, end).replace("function drawWaveform(", "function referenceWaveform("), { target: ts.ScriptTarget.ES2022 });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const origin = process.env.MUSIC_OS_RENDERER_ORIGIN ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-features=LocalNetworkAccessChecks"] });
try {
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  page.on("console", message => { if (message.type() === "error") console.error(message.text()); });
  await page.route("**/src/renderer/ui/App.tsx*", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + '\n' + reference + '\nexport { drawWaveform, referenceWaveform, SpectrumCanvas, LevelMeterCanvas, SpectrogramCanvas };' });
  });
  await page.route(`${origin}/__visualizer_performance`, route => route.fulfill({ contentType: "text/html", body: `<!doctype html>
    <style>canvas {width:600px;height:80px;--acc:#c3f53c;--acc-ink:#10130a;--bg0:#0b0d10} #meters canvas {width:150px;height:80px}</style>
    <canvas id="reference"></canvas><canvas id="optimized"></canvas><div id="meters"></div>
    <script type="module">
      import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
      const React = (await import('/node_modules/.vite/deps/react.js')).default;
      const {createRoot} = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
      const api = await import('/src/renderer/ui/App.tsx');
      const {createVisualizerCanvas} = await import('/src/renderer/visualizer-canvas.ts');
      const {createVisualizerAnimation} = await import('/src/renderer/visualizer-animation.ts');
      window.api = api; window.createVisualizerAnimation = createVisualizerAnimation;
      window.surfaces = ['reference','optimized'].map(id=>createVisualizerCanvas(document.getElementById(id)));
      const root = createRoot(document.getElementById('meters'));
      window.frameRef = {current:null};
      window.mount = playing => root.render(React.createElement(React.Fragment,null,
        React.createElement(api.SpectrumCanvas,{className:'spectrum',frameRef:window.frameRef,mode:'spectrum',playing}),
        React.createElement(api.LevelMeterCanvas,{className:'level',frameRef:window.frameRef,channel:'left',playing}),
        React.createElement(api.SpectrogramCanvas,{className:'spectrogram',frameRef:window.frameRef,fileId:'fixture',playing})));
      window.mount(false);
    </script>` }));
  await page.goto(`${origin}/__visualizer_performance`);
  await page.waitForFunction(() => window.surfaces && document.querySelector('#meters canvas'));
  const result = await page.evaluate(() => {
    const peaks = Array.from({length:2048},(_,i)=>Math.abs(Math.sin(i*.31)));
    const [reference, optimized] = window.surfaces;
    let largestError = 0;
    for (const variant of ['hero','rail']) for (const progress of [0,.1234,.5,1]) {
      window.api.referenceWaveform(reference,peaks,progress,variant);
      window.api.drawWaveform(optimized,peaks,progress,variant);
      const a=reference.context.getImageData(0,0,reference.canvas.width,reference.canvas.height).data;
      const b=optimized.context.getImageData(0,0,optimized.canvas.width,optimized.canvas.height).data;
      for(let i=0;i<a.length;i++) largestError=Math.max(largestError,Math.abs(a[i]-b[i]));
    }
    const original=CanvasRenderingContext2D.prototype.fillRect;
    let count=0;
    CanvasRenderingContext2D.prototype.fillRect=function(...args){count++;return original.apply(this,args)};
    const bench = draw => {count=0;const start=performance.now();for(let i=0;i<180;i++)draw(optimized,peaks,i/180,'hero');return {fillCalls:count,ms:performance.now()-start}};
    const before=bench(window.api.referenceWaveform),after=bench(window.api.drawWaveform);
    CanvasRenderingContext2D.prototype.fillRect=original;
    return {largestError,before,after};
  });
  assert.ok(result.largestError <= 2, `waveform pixels preserve appearance: max delta ${result.largestError}`);
  assert.ok(result.after.fillCalls < result.before.fillCalls / 50, 'waveform bars are rasterized once per layout/theme/peaks');
  // Observe real component paint work, including decay, visibility, pause/resume.
  await page.evaluate(() => {
    window.paints=0;
    const original=CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect=function(...args){if(this.canvas.closest('#meters'))window.paints++;return original.apply(this,args)};
  });
  await page.waitForTimeout(1200);
  await page.evaluate(()=>window.paints=0);
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(()=>window.paints),0,'paused meters stop painting');
  await page.evaluate(()=>window.mount(true));
  await page.waitForTimeout(150);
  assert.ok(await page.evaluate(()=>window.paints)>0,'play resumes drawing');
  await page.evaluate(()=>document.getElementById('meters').style.display='none');
  await page.waitForTimeout(100);
  await page.evaluate(()=>window.paints=0);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>window.paints),0,'CSS-hidden canvases stop drawing');
  await page.evaluate(()=>document.getElementById('meters').style.display='block');
  await page.waitForTimeout(150);
  assert.ok(await page.evaluate(()=>window.paints)>0,'visible canvases resume');
  await page.evaluate(() => {
    window.frameRef.current={fileId:'fixture',source:'sidecar',status:'playing',frameId:1,
      emittedAt:new Date().toISOString(),fftBins:[0,.2,.8,1],bands:[.3,.6],rms:.4,peak:.8};
  });
  await page.waitForTimeout(100);
  const history=await page.locator('.spectrogram').evaluate(canvas=>canvas.toDataURL());
  await page.evaluate(()=>window.mount(false));
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.spectrogram').evaluate(canvas=>canvas.toDataURL()),history,'pausing preserves spectrogram history');
  // Cached layers must refresh when peaks, density, size, or theme change.
  const invalidation=await page.evaluate(async()=>{
    const [reference,optimized]=window.surfaces;
    const peaks=[.9,.1,.6,.3];
    for(const surface of window.surfaces){surface.canvas.style.setProperty('--acc','#ff3355');surface.canvas.style.width='450px';}
    await new Promise(r=>setTimeout(r,300));
    Object.defineProperty(window,'devicePixelRatio',{configurable:true,value:1});
    window.api.referenceWaveform(reference,peaks,.42,'hero');window.api.drawWaveform(optimized,peaks,.42,'hero');
    return {equal:reference.canvas.toDataURL()===optimized.canvas.toDataURL(),width:optimized.canvas.width};
  });
  assert.deepEqual(invalidation,{equal:true,width:450});
  const lifecycle = await page.evaluate(async()=>{
    const wait=()=>new Promise(r=>setTimeout(r,100));
    let calls=0;
    const element=document.getElementById('optimized');
    const animation=window.createVisualizerAnimation(element,()=>{calls++;return true});
    await wait();
    Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));
    const hiddenAt=calls;await wait();const hiddenCalls=calls-hiddenAt;
    Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));
    await wait();const resumed=calls>hiddenAt;
    animation.dispose();const disposedAt=calls;await wait();
    return {hiddenCalls,resumed,disposedCalls:calls-disposedAt};
  });
  assert.deepEqual(lifecycle,{hiddenCalls:0,resumed:true,disposedCalls:0});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,...result,lifecycle}));
} finally {await browser.close()}
