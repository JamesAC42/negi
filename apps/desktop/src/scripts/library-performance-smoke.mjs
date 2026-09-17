import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const origin=process.env.MUSIC_OS_RENDERER_ORIGIN ?? 'http://127.0.0.1:5173';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:1100,height:800}});
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});
 await page.route('**/src/renderer/ui/App.tsx*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nexport { Artwork };'})});
 await page.route(origin+'/__library_performance',route=>route.fulfill({contentType:'text/html',body:`<!doctype html>
 <link rel="stylesheet" href="/src/renderer/styles.css"><style>
 body{display:block;margin:0;padding:20px}#fixture{display:flex;gap:20px}.libraryArtistList{height:500px;width:220px;background:#131722}
 #artViewport{height:300px;width:200px;overflow:auto}.testArt{display:block;width:100px;height:100px}.artFallback svg{height:100%}
 </style><div id="fixture"></div><script type="module">
 import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
 const React=(await import('/node_modules/.vite/deps/react.js')).default;
 const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
 const {VirtualArtistList}=await import('/src/renderer/ui/VirtualArtistList.tsx');
 const {Artwork}=await import('/src/renderer/ui/App.tsx');
 window.requests=[];const originalFetch=window.fetch;
 window.fetch=(src,options)=>String(src).startsWith('/fixture-cover/')?new Promise((resolve,reject)=>{
   const item={src,aborted:false,resolve:()=>resolve(new Response(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>'],{type:'image/svg+xml'})))};window.requests.push(item);
   options.signal.addEventListener('abort',()=>{item.aborted=true;reject(new DOMException('cancelled','AbortError'))},{once:true});
 }):originalFetch(src,options);
 const rows=Array.from({length:5000},(_,i)=>({artist:String(i).padStart(5,'0')+(i%9===0?' A very long translated artist name with wrapping 音楽':' Artist'),albums:4,tracks:48,letter:'A'}));
 window.rows=rows;window.listRef=React.createRef();window.selected=null;
 const root=createRoot(document.getElementById('fixture'));
 window.mount=(items=rows)=>root.render(React.createElement(React.Fragment,null,
   React.createElement(VirtualArtistList,{rows:items,ref:window.listRef,selected:null,empty:'No matching artists',onSelect:name=>window.selected=name}),
   React.createElement('div',{id:'artViewport'},Array.from({length:120},(_,i)=>React.createElement(Artwork,{key:i,src:'/fixture-cover/'+i,className:'testArt'})))));
 window.mount();
 </script>`}));
 await page.goto(origin+'/__library_performance');await page.waitForFunction(()=>window.listRef?.current && window.requests.length===2);
 await page.waitForTimeout(150);
 const mounted=await page.locator('.libraryArtistList > button').count();assert.ok(mounted<30,`windowed list mounts ${mounted}, not 5000 artists`);
 assert.equal(await page.evaluate(()=>window.requests.length),2,'only two images occupy network slots');
 await page.evaluate(()=>window.listRef.current.scrollToIndex(4200));
 await page.waitForFunction(()=>!!document.querySelector('button[data-index="4200"]'));
 await page.locator('button[data-index="4200"]').click();assert.match(await page.evaluate(()=>window.selected),/^04200/);
 await page.locator('button[data-index="4200"]').press('End');
 await page.waitForFunction(()=>document.activeElement?.dataset.index==='4999');
 await page.keyboard.press('Home');await page.waitForFunction(()=>document.activeElement?.dataset.index==='0');
 await page.evaluate(()=>window.mount(window.rows.filter(row=>row.artist.startsWith('031'))));
 await page.waitForFunction(()=>document.querySelector('.libraryArtistList > button')?.textContent.startsWith('03100'));
 assert.equal(await page.locator('.libraryArtistList').evaluate(el=>el.scrollTop),0,'filter resets stale scroll offset');
 await page.evaluate(()=>document.getElementById('artViewport').scrollTop=10000);
 await page.waitForFunction(()=>window.requests.slice(0,2).every(request=>request.aborted)&&window.requests.some(request=>Number(request.src.split('/').pop())>90));
 const requested=await page.evaluate(()=>window.requests.map(({src,aborted})=>({src,aborted})));
 assert.ok(requested.length<12,'rapid scrolling cancels queued covers instead of loading the intervening hundred');
 await page.evaluate(()=>window.requests.filter(request=>!request.aborted).forEach(request=>request.resolve()));
 await page.waitForFunction(()=>document.querySelectorAll('#artViewport img[src^="blob:"]').length>0);
 await page.evaluate(()=>window.mount([]));await page.getByText('No matching artists',{exact:true}).waitFor();
 const similarReads=[];
 await page.route('http://127.0.0.1:47831/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/explore/similar-artists')similarReads.push(path);
   if(path.startsWith('/artwork/'))return route.fulfill({status:404,body:'fixture has no art'});
   return route.fulfill({contentType:'application/json',body:JSON.stringify(path==='/explore/albums/jobs'?{jobs:[]}:path==='/explore/similar-artists'?{artistId:'fixture',artists:[],sources:[],pending:false}:{artists:[]})});
 });
 await page.route(origin+'/__artist_performance',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><style>body{margin:0}#collection{height:500px;overflow:auto}#connections{margin-top:5000px}</style><div id="root"></div><script type="module">
 import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
 const React=(await import('/node_modules/.vite/deps/react.js')).default;const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
 const {LibraryArtistPage}=await import('/src/renderer/ui/LibraryArtistPage.tsx');const {SimilarArtists}=await import('/src/renderer/ui/SimilarArtists.tsx');
 const albums=Array.from({length:60},(_,i)=>({id:'album'+i,artist:'Fixture',album:'Album '+i,year:'2026',fileCount:1,files:[]}));
 createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,
 React.createElement('div',{id:'collection'},React.createElement(LibraryArtistPage,{artist:'Fixture',albums,allAlbums:albums})),
 React.createElement('div',{id:'connections'},React.createElement(SimilarArtists,{artist:{id:'fixture',name:'Fixture'},onOpenArtist:()=>{}}))));
 </script>`}));
 await page.goto(origin+'/__artist_performance');
 await page.locator('.artistProfileLocalAlbums > button').first().waitFor();
 assert.equal(await page.locator('.artistProfileLocalAlbums > button').count(),24);
 await page.getByRole('button',{name:'Show more collection albums (36 more)',exact:true}).click();
 assert.equal(await page.locator('.artistProfileLocalAlbums > button').count(),48);
 await page.getByRole('button',{name:'Show more collection albums (12 more)',exact:true}).click();
 assert.equal(await page.locator('.artistProfileLocalAlbums > button').count(),60);
 assert.equal(similarReads.length,0,'offscreen connections do not fetch');
 await page.locator('#connections').scrollIntoViewIfNeeded();
 await page.waitForResponse(response=>new URL(response.url()).pathname==='/explore/similar-artists');
 assert.equal(similarReads.length,1,'connections load on viewport entry');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,artists:5000,mountedArtistRows:mounted,artworkRequests:requested}));
}finally{await browser.close()}
