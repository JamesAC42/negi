import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const origin=process.env.MUSIC_OS_RENDERER_ORIGIN ?? 'http://127.0.0.1:5173';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:1200,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let fail=false;let delay=0;
 await page.route('http://127.0.0.1:47831/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname!=='/home/listening')return route.fulfill({status:503,body:'fixture: optional taste unavailable'});
  await new Promise(resolve=>setTimeout(resolve,delay));
  await route.fulfill({status:fail?503:200,contentType:'application/json',body:JSON.stringify(fail?{message:'Fixture refresh failed'}:{since:'2026-09-01T00:00:00.000Z',until:'2026-09-16T00:00:00.000Z',files:[],days:[],hours:[],recent:[]})});
 });
 await page.route('**/src/renderer/ui/App.tsx*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nexport { HomeAnalyticsView };'})});
 await page.route(origin+'/__home_refresh_smoke',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><link rel="stylesheet" href="/src/renderer/styles.css"><style>.homeAnalyticsView{height:700px;width:1100px}.homeAnalyticsScroll{height:630px}</style><div id="fixture"></div><script type="module">
 import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
 const React=(await import('/node_modules/.vite/deps/react.js')).default;const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
 const {HomeAnalyticsView}=await import('/src/renderer/ui/App.tsx');const root=createRoot(document.getElementById('fixture'));
 window.renderHome=()=>root.render(React.createElement(HomeAnalyticsView,{albumsState:{status:'ready',albums:{albums:[],total:0}},playback:{status:'paused',currentFileId:null},playbackBusy:false,onRefreshLibrary:async()=>null}));window.renderHome();
 </script>`}));
 await page.goto(origin+'/__home_refresh_smoke');await page.locator('.hjFooter').waitFor();
 await page.evaluate(()=>{window.main=document.querySelector('.hjMain');document.querySelector('.homeAnalyticsScroll').scrollTop=500});
 delay=350;
 for(const failing of [false,true,false]){
  fail=failing;
  await page.evaluate(()=>window.renderHome());
  await page.waitForFunction(()=>document.querySelector('.homeAnalyticsScroll').getAttribute('aria-busy')==='true');
  const during=await page.evaluate(()=>({same:window.main===document.querySelector('.hjMain'),top:document.querySelector('.homeAnalyticsScroll').scrollTop}));
  assert.equal(during.same,true,'background refresh retains Home DOM');assert.ok(during.top>=450,'background loading retains scroll position');
  await page.waitForFunction(()=>document.querySelector('.homeAnalyticsScroll').getAttribute('aria-busy')==='false');
  assert.equal(await page.evaluate(()=>window.main===document.querySelector('.hjMain')),true,'refresh success/failure never unmounts content');
  assert.ok(await page.locator('.homeAnalyticsScroll').evaluate(el=>el.scrollTop)>400,'scroll survives refresh completion');
  assert.equal(await page.locator('[role="alert"]').count(),failing?1:0);
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,refreshSuccess:true,refreshFailure:true,recovery:true,scrollPreserved:true}));
}finally{await browser.close()}
