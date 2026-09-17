import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const origin = process.env.MUSIC_OS_RENDERER_ORIGIN ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let jobs = [{ id: 'a', status: 'running', progress: 10 }, { id: 'b', status: 'running', progress: 10 }];
  let fail = false;
  await page.route('http://127.0.0.1:47831/**', route => route.fulfill({
    status: fail ? 503 : 200, contentType: 'application/json',
    body: JSON.stringify(fail ? { message: 'Fixture unavailable' } : { jobs }),
  }));
  await page.route(origin + '/__explore_jobs_smoke', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><div id="fixture"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
    const React=(await import('/node_modules/.vite/deps/react.js')).default;
    const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const {useExploreJobs}=await import('/src/renderer/ui/explore-api.ts');
    window.jobUpdates=0;window.libraryEvents=0;window.responses=0;
    window.addEventListener('music-library-changed',()=>window.libraryEvents++);
    const originalFetch=window.fetch.bind(window);
    window.fetch=async(...args)=>{const response=await originalFetch(...args);const originalJson=response.json.bind(response);response.json=async()=>{const data=await originalJson();window.responses++;return data};return response};
    function Fixture(){const {jobs,error}=useExploreJobs('/explore/albums/jobs');React.useEffect(()=>{window.jobUpdates++},[jobs]);window.currentJobs=jobs;window.currentError=error;return React.createElement('div',null,error||JSON.stringify(jobs))}
    createRoot(document.getElementById('fixture')).render(React.createElement(Fixture));
  </script>` }));
  await page.goto(origin + '/__explore_jobs_smoke');
  await page.waitForFunction(() => window.currentJobs?.length === 2 && window.jobUpdates === 2);
  const refresh = async () => {
    const count = await page.evaluate(() => { const count = window.responses; window.dispatchEvent(new Event('explore-jobs-changed')); return count; });
    await page.waitForFunction(count => window.responses > count, count);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  for (let i = 0; i < 8; i++) await refresh();
  assert.equal(await page.evaluate(() => window.jobUpdates), 2, 'unchanged polls preserve the jobs snapshot');
  jobs = jobs.map(job => ({ ...job, progress: 25 }));
  await refresh();
  assert.equal(await page.evaluate(() => window.currentJobs[0].progress), 25, 'progress changes remain visible');
  assert.equal(await page.evaluate(() => window.jobUpdates), 3);
  jobs = jobs.map(job => ({ ...job, status: 'succeeded', progress: 100 }));
  await refresh();
  assert.equal(await page.evaluate(() => window.libraryEvents), 1, 'batch completion refreshes the library only once');
  await refresh();
  assert.equal(await page.evaluate(() => window.libraryEvents), 1, 'completed jobs do not repeat library refreshes');
  fail = true; await refresh();
  assert.equal(await page.evaluate(() => window.currentError), 'Fixture unavailable');
  fail = false; await refresh();
  assert.equal(await page.evaluate(() => window.currentError), '');
  assert.equal(await page.evaluate(() => window.jobUpdates), 4, 'error recovery preserves unchanged jobs');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, unchangedPolls: 8, redundantJobUpdates: 0, batchCompletionEvents: 1, progressAndErrorRecovery: true }));
} finally { await browser.close(); }
