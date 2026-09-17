// Isolated Library fixture; every backend request is intercepted.
import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const origin = process.env.MUSIC_OS_RENDERER_ORIGIN ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("http://127.0.0.1:47831/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/artwork/")) return route.fulfill({ status: 404, body: "No fixture artwork" });
    return route.fulfill({ json: path === "/explore/albums/jobs" ? { jobs: [] } : { album: null } });
  });
  await page.route("**/src/renderer/ui/App.tsx*", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + "\nexport { LibraryWorkbenchView };" });
  });
  await page.route(origin + "/__library_letters", route => route.fulfill({ contentType: "text/html", body: `<!doctype html>
    <link rel="stylesheet" href="/src/renderer/styles.css">
    <style>body{margin:0}#fixture{height:900px;padding:20px}.libraryWorkbench{height:850px}.libraryArtistList{height:500px}</style>
    <div id="fixture" class="appShell theme-dark"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
    const React=(await import('/node_modules/.vite/deps/react.js')).default;
    const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const {LibraryWorkbenchView}=await import('/src/renderer/ui/App.tsx');
    const albums=['0',...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].flatMap((letter,i)=>Array.from({length:6},(_,j)=>({
      id:letter+j,artist:letter+' Artist '+j,album:'Fixture album',year:'2026',fileCount:1,durationMs:1000,formats:['FLAC'],
      files:[{id:'file-'+letter+j,filename:'Fixture.flac',extension:'flac',displayTags:{title:'Fixture song'},
        ctime:new Date(2026,0,i+1).toISOString(),mtime:new Date(2026,0,i+1).toISOString(),playCount:i*10+j,liked:i>12,rating:null}]
    })));
    const root=createRoot(document.getElementById('fixture')); let revision=0;
    window.mount=(mode='recent',favoriteOnly=false)=>{
      localStorage.setItem('music-os:library-workbench:v1',JSON.stringify({artistSortMode:mode,albumSortMode:mode==='artist'?'artistAlbum':mode,favoriteOnly}));
      root.render(React.createElement(LibraryWorkbenchView,{
        key:++revision,initialTarget:null,albumsState:{status:'ready',albums:{albums}},
        currentWaveform:null,favoriteAlbumEntries:favoriteOnly?albums.map(album=>album.id):[],favoriteBusy:false,favoriteError:null,
        playback:{currentFileId:null,status:'idle'},playbackBusy:false,
        onAlbumArtworkChanged:()=>{},onEnqueuePlayback:async()=>{},onManage:()=>{},onPlayAlbum:async()=>{},onPlayFile:async()=>{},
        onReassignAlbumsToArtist:async()=>{},onSetAlbumFavorite:async()=>{},onSetArtistAlbumsFavorite:async()=>{},
        onSetFileFavoriteStatus:async()=>{},onSetFileRating:async()=>{}
      }));
    }; window.mount();
    </script>` }));
  await page.goto(origin + "/__library_letters");
  const artistSort = page.getByRole("button", { name: "Sort artists", exact: true });
  const albumSort = page.getByRole("button", { name: "Sort albums", exact: true });
  async function jump(letter) {
    await page.getByRole("button", { name: letter === "#" ? "Jump to numeric artists" : "Jump to artists beginning with " + letter, exact: true }).click();
    await page.waitForFunction(letter => {
      const viewport = document.querySelector('.libraryArtistList');
      const bounds = viewport.getBoundingClientRect();
      return [...viewport.querySelectorAll('button[data-artist]')].some(row =>
        row.dataset.startLetter === letter && row.getBoundingClientRect().top >= bounds.top - 1 && row.getBoundingClientRect().top < bounds.bottom);
    }, letter);
    assert.match(await artistSort.textContent(), /A–Z/);
    assert.match(await albumSort.textContent(), /A–Z/);
    const preferences = await page.evaluate(() => JSON.parse(localStorage.getItem('music-os:library-workbench:v1')));
    assert.equal(preferences.artistSortMode, 'artist');
    assert.equal(preferences.albumSortMode, 'artistAlbum');
  }
  await artistSort.waitFor();
  for (const mode of ['recent', 'listens', 'likes', 'artist']) {
    await page.evaluate(mode => window.mount(mode), mode);
    const expectedLabel = { recent: 'Recently added', listens: 'Most listens', likes: 'Most likes', artist: 'A–Z' }[mode];
    await page.waitForFunction(label => document.querySelector('[aria-label="Sort artists"]')?.textContent.includes(label), expectedLabel);
    await jump('M');
    // Repeating the same letter still works after manually scrolling away.
    await page.locator('.libraryArtistList').evaluate(node => { node.scrollTop = 0; });
    await jump('M');
    await jump('#');
  }
  await page.evaluate(() => window.mount('recent'));
  await page.getByRole('textbox', { name: 'Filter artists' }).fill('Artist 2');
  await page.waitForFunction(() => [...document.querySelectorAll('.libraryArtistList [data-artist]')].every(row => row.dataset.artist.endsWith('2')));
  await jump('M');
  assert.equal(await page.getByRole('textbox', { name: 'Filter artists' }).inputValue(), 'Artist 2');
  await page.evaluate(() => window.mount('recent', true));
  await page.waitForFunction(() => document.querySelector('.libraryFavoritesOnly')?.getAttribute('aria-pressed') === 'true');
  await jump('M');
  assert.equal(await page.getByRole('button', { name: 'Favorites only' }).getAttribute('aria-pressed'), 'true');
  await page.setViewportSize({ width: 700, height: 800 });
  await jump('S');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, initialSorts: ['recent', 'listens', 'likes', 'artist'], repeatJump: true, numericJump: true, preservedFilters: true, widths: [1440, 700] }));
} finally {
  await browser.close();
}
