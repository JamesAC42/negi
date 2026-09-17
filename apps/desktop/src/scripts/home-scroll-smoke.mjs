import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const origin=process.env.MUSIC_OS_RENDERER_ORIGIN ?? 'http://127.0.0.1:5173';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:1200,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const albums=Array.from({length:29},(_,i)=>({id:'album-'+i,artist:'Artist '+i,album:'Album '+i,year:'2026',fileCount:1,formats:['FLAC'],durationMs:120000,files:[{id:'file-'+i,filename:'Track '+i,displayTags:{artist:'Artist '+i,album:'Album '+i,title:'Track '+i,year:'2026'},playCount:i<25?1:0,favoriteStatus:'neutral',rating:null,durationMs:120000}]}));
 const listening={since:'2026-09-01T00:00:00.000Z',until:'2026-09-16T00:00:00.000Z',files:albums.slice(0,25).map((album,i)=>({fileId:'file-'+i,plays:25-i,listenedMs:120000,skips:0,firstPlayedAt:null})),days:[],hours:[],recent:[]};
 await page.route('http://127.0.0.1:47831/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.startsWith('/artwork/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="green"/></svg>'});
  if(url.pathname!=='/home/listening')return route.fulfill({status:503,body:'optional taste unavailable'});
  await route.fulfill({contentType:'application/json',body:JSON.stringify(listening)});
 });
 await page.route('**/src/renderer/ui/App.tsx*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nexport { HomeAnalyticsView };'})});
 await page.route(origin+'/__home_scroll_smoke',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><link rel="stylesheet" href="/src/renderer/styles.css"><style>.homeAnalyticsView{height:700px;width:1100px}.homeAnalyticsScroll{height:630px}</style><div id="fixture"></div><script type="module">
 import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
 const React=(await import('/node_modules/.vite/deps/react.js')).default;const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
 const {HomeAnalyticsView}=await import('/src/renderer/ui/App.tsx');const root=createRoot(document.getElementById('fixture'));
 window.renderHome=()=>root.render(React.createElement(HomeAnalyticsView,{albumsState:{status:'ready',albums:{albums:${JSON.stringify(albums)},total:29}},playback:{status:'paused',currentFileId:null},playbackBusy:false,onRefreshLibrary:async()=>null}));window.renderHome();
 </script>`}));
 await page.goto(origin+'/__home_scroll_smoke');await page.locator('.hjFooter').waitFor();
 await page.waitForFunction(()=>document.querySelectorAll('.homeCollageGrid img').length===25);
 await page.mouse.move(400,350);
 const samples=[];
 for(let i=0;i<14;i++){
   const before=await page.locator('.homeAnalyticsScroll').evaluate(el=>({top:el.scrollTop,max:el.scrollHeight-el.clientHeight}));
   await page.mouse.wheel(0,180);await page.waitForTimeout(150);
   const after=await page.locator('.homeAnalyticsScroll').evaluate(el=>({top:el.scrollTop,max:el.scrollHeight-el.clientHeight}));
   assert.ok(Math.abs(after.top-Math.min(before.top+180,after.max))<=1,`artwork visibility must not undo wheel scrolling: ${JSON.stringify({before,after})}`);
   samples.push(after.top);
 }
 assert.ok(await page.locator('.homeAnalyticsScroll').evaluate(el=>Math.abs(el.scrollHeight-el.clientHeight-el.scrollTop)<2),'bottom remains reachable');
 assert.ok(await page.locator('.homeCollageGrid img').count()<25,'test actually released offscreen covers');
 const footer=await page.locator('.hjFooter').boundingBox();assert.ok(footer && footer.y>=0 && footer.y+footer.height<=800,'footer is visible');
 for(let i=0;i<14;i++){await page.mouse.wheel(0,-180);await page.waitForTimeout(100)}
 assert.equal(await page.locator('.homeAnalyticsScroll').evaluate(el=>el.scrollTop),0,'can scroll back to top');
 await page.waitForFunction(()=>document.querySelectorAll('.homeCollageGrid img').length===25);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,downwardScrollPositions:samples,footerReachable:true,coversReloaded:true}));
}finally{await browser.close()}
