import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const origin = process.env.MUSIC_OS_RENDERER_ORIGIN ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}), args: ['--no-sandbox'] });
const screenshotDir = new URL('../../../../.dream-loop/', import.meta.url);
await mkdir(screenshotDir, { recursive: true });
const video = (i, title = `Fixture performance ${i}`) => ({ id: `fixture${String(i).padStart(4, '0')}`, title, channel: 'Fixture Music', channelId: 'UCabcdefghijklmnopqrstuv', channelUrl: 'https://www.youtube.com/@fixture', duration: 300 + i, url: `https://www.youtube.com/watch?v=fixture${String(i).padStart(4, '0')}`, thumbnail: origin + '/fixture-art.svg', description: 'An isolated music browsing fixture.', viewCount: 250000 + i, uploadDate: '2026-08-15', liveStatus: 'not_live' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(12000);
  const errors = [], requests = [], mutations = [];
  let jobs = [], fail = false, slowRelease, jobReads = 0;
  page.on('pageerror', error => errors.push(error.message));

  const art = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g"><stop stop-color="#37423e"/><stop offset="1" stop-color="#bb8252"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><circle cx="320" cy="170" r="90" fill="#273532"/><text x="320" y="310" text-anchor="middle" fill="#f0e6d2" font-size="27">LIVE MUSIC · FIXTURE</text></svg>';
  await page.route(origin + '/fixture-art.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: art }));
  await page.route('http://127.0.0.1:47831/**', async route => {
    const url = new URL(route.request().url());
    const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); mutations.push({ path: url.pathname, body });
      if (url.pathname.endsWith('/download')) jobs = [{ id: 'fixture-job', url: body.url, status: 'review', title: 'Review recording', artist: 'Fixture artist', album: 'Fixture album', year: '2026', codec: 'opus', createdAt: '2026-09-16T00:00:00Z' }];
      return reply({ ok: true });
    }
    if (url.pathname.endsWith('/health')) return reply({ available: true, message: '' });
    if (url.pathname.endsWith('/jobs')) {jobReads++; return reply({ jobs });}
    if (url.pathname === '/library/albums') return reply({albums:[]});
    if (url.pathname === '/library/roots') return reply({ roots: [{ id: 'fixture-root', path: '/fixture/library' }] });
    if (url.pathname.endsWith('/artwork')) return route.fulfill({ contentType: 'image/svg+xml', body: art });
    if (url.pathname.endsWith('/preferences')) return reply({ personalized: true, homeQueries: ['Fixture Music music'], topics: [{ id: 'genre:trip hop', label: 'Trip hop', query: 'Trip hop music' }] });
    if (url.pathname.endsWith('/home')) {
      requests.push({kind: 'home', page: url.searchParams.get('page') || '1'});
      return reply({results: url.searchParams.get('page') === '2' ? [video(11), video(12), video(13)] : Array.from({length: 12}, (_, i) => video(i)), title: 'For you', nextPage: url.searchParams.get('page') === '2' ? null : 2, sourceUrl: 'https://www.youtube.com/'});
    }
    if (url.pathname.endsWith('/browse')) {
      const query = Object.fromEntries(url.searchParams); requests.push(query);
      if (query.q === 'slow') await new Promise(resolve => { slowRelease = resolve; });
      if (fail) return reply({ message: 'Fixture connection interrupted' }, 503);
      const results = query.q === 'slow' ? [video(80, 'Stale response')] : query.q === 'fast' ? [video(81, 'Latest response')] : query.page === '2' ? [video(11), video(12), video(13)] : Array.from({ length: 12 }, (_, i) => video(i));
      return reply({ results, channels: query.q === 'Fixture Music' ? [{id: 'UCabcdefghijklmnopqrstuv', name: 'Fixture Music', url: 'https://www.youtube.com/@fixture', matchedVideos: 12}] : [], title: query.kind === 'channel' ? 'Fixture channel uploads' : 'Fixture playlist', nextPage: query.page === '2' || ['slow', 'fast'].includes(query.q) ? null : 2, sourceUrl: 'https://www.youtube.com/results?search_query=fixture' });
    }
    throw new Error(`Unmocked API request: ${url}`);
  });
  await page.route(origin + '/__youtube_browser_smoke', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><link rel="stylesheet" href="/src/renderer/styles.css"><style>html,body,#fixture{height:100%;margin:0}#fixture{padding:20px;box-sizing:border-box}.youtubeWorkspace{height:100%;display:flex;flex-direction:column;min-height:0}</style><div id="fixture"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
    const React=(await import('/node_modules/.vite/deps/react.js')).default;const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const {YoutubeExplorer}=await import('/src/renderer/ui/YoutubeExplorer.tsx');const root=createRoot(document.getElementById('fixture'));
    window.setYoutubeActive=(active)=>root.render(React.createElement(YoutubeExplorer,{active}));window.setYoutubeActive(true);
  </script>` }));
  const search = async q => { await page.getByRole('textbox', { name: 'Search YouTube' }).fill(q); await page.getByRole('button', { name: 'Search', exact: true }).click(); };
  const ready = async count => { await page.waitForFunction(n => document.querySelector('.ytVideoGrid')?.getAttribute('aria-busy') === 'false' && document.querySelectorAll('.ytCard').length === n, count); };
  await page.goto(origin + '/__youtube_browser_smoke'); await ready(12);
  assert.equal(requests[0].kind, 'home');
  assert.equal(await page.getByText('Find your next obsession').count(), 0);
  await page.getByText('Based on your favorite artists and genres in Settings.').waitFor();
  for (const width of [1440, 900, 650]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('.ytBrowseScroll').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: fileURLToPath(new URL(`youtube-fixture-${width}.png`, screenshotDir)) });
    const overflow = await page.evaluate(() => ({ body: document.body.scrollWidth - innerWidth, scroll: document.querySelector('.ytBrowseScroll').scrollWidth - document.querySelector('.ytBrowseScroll').clientWidth }));
    assert.ok(overflow.body <= 1 && overflow.scroll <= 1, `No horizontal content overflow at ${width}: ${JSON.stringify(overflow)}`);
    await page.locator('.ytBrowseScroll').hover(); await page.mouse.wheel(0, 20000);
    await page.waitForFunction(() => { const el = document.querySelector('.ytBrowseScroll'); return el.scrollHeight - el.clientHeight - el.scrollTop < 2; });
    const footer = await page.locator('.youtubeWorkspaceFooter').boundingBox(); assert.ok(footer.y + footer.height <= 901, `Footer reachable at ${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Load more videos', exact: true }).click(); await ready(14);
  assert.equal(await page.getByRole('button', { name: 'Watch Fixture performance 11', exact: true }).count(), 1, 'Pagination deduplicates videos');
  await page.getByRole('combobox', { name: 'Filter loaded videos by duration' }).selectOption('short'); await ready(0);
  await page.getByText('No loaded videos match this length').waitFor();
  await page.getByRole('combobox', { name: 'Filter loaded videos by duration' }).selectOption('all'); await ready(14);
  await search('Fixture Music'); await ready(12);
  await page.getByRole('region', { name: 'Matching YouTube channels' }).getByRole('button').click(); await ready(12);
  assert.equal(requests.at(-1).kind, 'channel'); assert.equal(requests.at(-1).q, 'UCabcdefghijklmnopqrstuv');
  await page.getByRole('button', { name: 'Back to previous results', exact: true }).click(); await ready(12);
  await page.getByRole('region', { name: 'Matching YouTube channels' }).waitFor();
  await page.getByRole('button', { name: 'Trip hop', exact: true }).click(); await ready(12); assert.equal(requests.at(-1).q, 'Trip hop music');
  await page.locator('.ytChannelLink').first().click(); await ready(12); assert.equal(requests.at(-1).kind, 'channel'); assert.equal(requests.at(-1).q, 'UCabcdefghijklmnopqrstuv');
  await search('https://www.youtube.com/playlist?list=PLfixture'); await ready(12); assert.equal(requests.at(-1).kind, 'playlist');
  await search('slow'); await page.waitForFunction(() => document.querySelector('.ytLoading'));
  while (!slowRelease) await new Promise(resolve => setTimeout(resolve, 10));
  await search('fast'); await ready(1); slowRelease(); await page.waitForTimeout(100);
  assert.equal(await page.locator('.ytVideoTitle').textContent(), 'Latest response', 'Late response cannot overwrite current search');
  fail = true; await search('error fixture'); await page.getByText('Fixture connection interrupted').waitFor();
  fail = false; await page.getByRole('button', { name: 'Try again', exact: true }).click(); await ready(12);
  await page.getByRole('button', { name: 'Save to Watch later: Fixture performance 0', exact: true }).click();
  await page.reload(); await ready(12);
  await page.getByRole('button', { name: /^Watch later/ }).first().click(); await ready(1);
  // Native playback, history, close confirmation and background controls have their own real-media fixture.
  await page.getByRole('button', { name: 'Browse', exact: true }).click(); await ready(12);
  await page.getByRole('button', { name: 'Download audio: Fixture performance 0', exact: true }).click();
  await page.getByLabel('artist', { exact: true }).fill('Edited artist');
  await page.getByRole('button', { name: 'Browse', exact: true }).click();
  await page.getByRole('button', { name: /^Audio inbox/ }).click();
  assert.equal(await page.getByLabel('artist', { exact: true }).inputValue(), 'Edited artist', 'Hidden inbox keeps metadata edits');
  assert.equal(mutations.length, 1, 'Browsing and downloading do not import automatically');
  await page.getByRole('button', { name: 'Import into library', exact: true }).click();
  await page.getByText('Imported Review recording into your library.').waitFor();
  assert.equal(mutations.length, 2); assert.equal(mutations[1].body.artist, 'Edited artist'); assert.equal(mutations[1].body.libraryRootId, 'fixture-root');
  await page.route(origin + '/__discovery_retention_smoke', route => route.fulfill({contentType:'text/html',body:`<!doctype html><link rel="stylesheet" href="/src/renderer/styles.css"><style>html,body,#fixture{height:100%;margin:0}#fixture{padding:20px;box-sizing:border-box}.exploreWorkspace{height:100%;display:flex;flex-direction:column;min-height:0}.discoveryModeContent{flex:1;min-height:0}.youtubeWorkspace{height:100%;display:flex;flex-direction:column;min-height:0}</style><div id="fixture"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
    const React=(await import('/node_modules/.vite/deps/react.js')).default;const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;const {DiscoveryModes}=await import('/src/renderer/ui/Explore.tsx');const root=createRoot(document.getElementById('fixture'));
    window.setDiscoveryVisible=visible=>root.render(React.createElement('div',{hidden:!visible,style:{display:visible?'contents':'none'}},React.createElement(DiscoveryModes,{visible},React.createElement('p',null,'Soulseek fixture'))));window.setDiscoveryVisible(true);
  </script>`}));
  await page.goto(origin + '/__discovery_retention_smoke');
  await page.getByRole('navigation',{name:'Discovery sections'}).getByRole('button',{name:'YouTube',exact:true}).click();await ready(12);
  await search('Fixture Music');await ready(12);
  await page.locator('.ytBrowseScroll').evaluate(el=>{el.scrollTop=200;window.retainedYoutubeScroll=el;window.retainedScrollTop=el.scrollTop;});
  const requestsBeforeHide=requests.length;
  await page.evaluate(()=>window.setDiscoveryVisible(false));
  await page.waitForTimeout(50);const readsWhileHidden=jobReads;
  await page.evaluate(()=>window.dispatchEvent(new Event('explore-jobs-changed')));
  await page.waitForTimeout(2600);assert.equal(jobReads,readsWhileHidden,'Hidden Discovery stops both event refreshes and polling');
  await page.evaluate(()=>window.setDiscoveryVisible(true));await ready(12);
  assert.equal(await page.getByRole('navigation',{name:'Discovery sections'}).getByRole('button',{name:'YouTube',exact:true}).getAttribute('aria-current'),'page','Leaving Discovery retains its selected source');
  assert.equal(await page.getByRole('textbox',{name:'Search YouTube'}).inputValue(),'Fixture Music');
  assert.equal(requests.length,requestsBeforeHide,'Returning retains fetched location/results');
  assert.ok(await page.locator('.ytBrowseScroll').evaluate(el=>el===window.retainedYoutubeScroll&&el.scrollTop===window.retainedScrollTop),'Returning retains DOM and scroll position');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, responsiveWidths: [1440, 900, 650], topics: true, channelAndPlaylistNavigation: true, paginationDedupe: true, staleSearchProtection: true, retry: true, persistentWatchLater: true, strongChannelMatch: true, personalizedHome: true, discoverySourceLocationScrollRetention: true, hiddenPollingStopped: true, preservedReviewEdits: true, onlyMockMutations: mutations.map(m => m.path) }));
} finally { await browser.close(); }
