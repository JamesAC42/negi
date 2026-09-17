import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const origin=process.env.MUSIC_OS_RENDERER_ORIGIN ?? 'http://127.0.0.1:5173';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://127.0.0.1:47831/**',route=>route.fulfill({status:404,body:'fixture'}));
 await page.route('**/src/renderer/ui/App.tsx*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nexport { PlaylistsView };'})});
 await page.route(origin+'/__playlist_performance_smoke',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><link rel="stylesheet" href="/src/renderer/styles.css"><div id="fixture"></div><script type="module">
 import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
 const React=(await import('/node_modules/.vite/deps/react.js')).default;const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
 const {PlaylistsView}=await import('/src/renderer/ui/App.tsx');const root=createRoot(document.getElementById('fixture'));
 window.durationReads=0;window.duration=60000;
 const empty={id:'empty',name:'Empty',items:[],createdBy:'user',type:'manual'};
 const playlists=[empty,...Array.from({length:100},(_,i)=>({id:'list'+i,name:'List '+i,createdBy:'user',type:'manual',items:Array.from({length:100},(_,j)=>({id:i+'-'+j,file:{id:i+'-'+j,filename:'Track',displayTags:{},get durationMs(){window.durationReads++;return window.duration;}}}))}))];
 window.state={status:'ready',playlists};
 window.renderLists=()=>root.render(React.createElement(PlaylistsView,{playlistsState:window.state,selectedPlaylist:empty,playback:{status:'paused',positionMs:Date.now()},onBack:()=>{},onOpenPlaylist:()=>{}}));
 window.renderLists();
 </script>`}));
 await page.goto(origin+'/__playlist_performance_smoke');await page.locator('.playlistBrowserRows button').last().waitFor();
 assert.equal(await page.evaluate(()=>window.durationReads),10000);
 const before=await page.locator('.playlistBrowserRows button').nth(1).innerText();
 await page.evaluate(()=>{window.durationReads=0;window.renderLists()});await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>window.durationReads),0,'playback updates reuse track totals');
 await page.getByRole('textbox',{name:'Filter playlists'}).fill('List 99');
 await page.waitForFunction(()=>document.querySelectorAll('.playlistBrowserRows button').length===1);
 assert.equal(await page.evaluate(()=>window.durationReads),0,'filter typing reuses track totals');
 await page.getByRole('textbox',{name:'Filter playlists'}).fill('');
 await page.evaluate(()=>{window.duration=120000;window.state={...window.state,playlists:[...window.state.playlists]};window.renderLists()});
 await page.waitForFunction(()=>window.durationReads===10000);
 assert.notEqual(await page.locator('.playlistBrowserRows button').nth(1).innerText(),before,'fresh playlist snapshot refreshes totals');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,tracks:10000,initialDurationReads:10000,playbackAndFilterDurationReads:0,updatedSnapshotDurationReads:10000}));
}finally{await browser.close()}
