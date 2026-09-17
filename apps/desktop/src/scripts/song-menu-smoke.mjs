// Runs against the dev renderer; all playlist/queue writes are intercepted.
// PLAYWRIGHT_MODULE may point to an external Playwright installation.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.MUSIC_OS_RENDERER_URL || "http://127.0.0.1:5173";
const api = process.env.MUSIC_OS_BACKEND_URL || "http://127.0.0.1:47831";
const files = await (await fetch(api + "/library/files?limit=1")).json();
const file = files.files[0];
assert(file, "A library song is required for the browser fixture");
const item = (id) => ({id:"item-"+id,position:0,file:{...file,id},track:{id:"track-"+id,title:"Fixture song"}});
const lists = Array.from({length:24},(_,i)=>({id:"menu-test-"+i,name:i===0?"Evening rotation":i===1?"Morning favorites":i===2?"Retry destination":i===3?"Alternate recording":"Collection "+String(i).padStart(2,"0"),description:null,type:"manual",createdBy:"user",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),items:i===23?[item(file.id)]:[]}));
const browser = await chromium.launch({headless:true,args:["--no-sandbox"]});
await mkdir(".music-os/song-playlist-qa",{recursive:true});
try {
 const page = await browser.newPage({viewport:{width:1440,height:1000}});
 page.setDefaultTimeout(12000);
 const errors=[];const writes=[];const queues=[];
 let current;let fail=false;let duplicate=false;
 page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/playlists",r=>r.fulfill({json:{playlists:lists}}));
 await page.route("**/operations/**",async r=>{
  if(r.request().method()!=="POST")return r.continue();
  const path=new URL(r.request().url()).pathname;
  const body=r.request().postDataJSON();
  writes.push({path,body});
  if(path.endsWith("propose-add-tracks-to-playlist"))current=body;
  assert(["/operations/propose-add-tracks-to-playlist","/operations/approve-batch","/operations/apply-batch"].includes(path));
  const status=path.endsWith("apply-batch")?(fail?"failed":"applied"):path.endsWith("approve-batch")?"approved":"proposed";
  if(status==="applied"&&!duplicate)lists.find(p=>p.id===current.playlistId).items.push(item(current.fileIds[0]));
  await r.fulfill({json:{batch:{id:"menu-batch",source:"user",status,summary:"Add song",riskLevel:"low",agentThreadId:null,operations:[{id:"menu-operation",batchId:"menu-batch",type:"add_tracks_to_playlist",status,payload:current,before:null,after:status==="applied"?{addedCount:duplicate?0:1,skippedCount:duplicate?1:0}:null,error:status==="failed"?{message:"Fixture save failed. Try again."}:null}]}}});
 });
 await page.route("**/playback/enqueue",async r=>{
  queues.push(r.request().postDataJSON());
  await r.fulfill({json:await (await fetch(api+"/playback/state")).json()});
 });
 await page.goto(origin);
 await page.getByRole("button",{name:"Library",exact:true}).click();
 const row=page.locator(".libraryTrackRow").first();
 await row.waitFor();await page.waitForTimeout(800);
 const menu=page.locator(".songQueueMenu");
 async function open(row) {
  await row.click({button:"right"});
  await page.getByRole("menuitem",{name:"Add to playlist",exact:true}).click();
  await page.getByRole("textbox",{name:"Search playlists"}).waitFor();
 }
 const search=page.getByRole("textbox",{name:"Search playlists"});
 await open(row);
 assert(await search.evaluate(el=>el===document.activeElement));
 await search.fill("no-such-list");
 await page.getByText("No matching playlists.",{exact:true}).waitFor();
 await search.fill("Evening");
 await page.keyboard.press("ArrowDown");
 assert.match(await page.evaluate(()=>document.activeElement.textContent),/Evening rotation/);
 await page.keyboard.press("Enter");
 await page.getByRole("status").filter({hasText:"Added to Evening rotation"}).waitFor();
 assert.equal(writes.length,3);
 assert.equal(writes[0].body.fileIds.length,1);
 assert.equal(writes[0].body.playlistId,lists[0].id);
 assert(await page.getByRole("button",{name:/Evening rotation.*Already added/}).isDisabled());
 await search.fill("Retry");
 fail=true;
 await page.getByRole("button",{name:/Retry destination/}).click();
 await page.getByRole("alert").filter({hasText:"Fixture save failed"}).waitFor();
 assert.equal(await page.getByRole("status").count(),0);
 fail=false;
 await page.getByRole("button",{name:/Retry destination/}).click();
 await page.getByRole("status").filter({hasText:"Added to Retry destination"}).waitFor();
 duplicate=true;
 await search.fill("Alternate");
 await page.getByRole("button",{name:/Alternate recording/}).click();
 await page.getByRole("status").filter({hasText:"Already in Alternate recording"}).waitFor();
 duplicate=false;
 await search.fill("");
 await page.locator(".songPlaylistOptions").evaluate(el=>el.scrollTop=el.scrollHeight);
 await page.waitForTimeout(100);
 assert(await menu.isVisible(),"scrolling playlist choices keeps picker open");
 await page.keyboard.press("Escape");
 await page.getByRole("menuitem",{name:"Play next"}).waitFor();
 await page.keyboard.press("Escape");
 await menu.waitFor({state:"detached"});
 assert(await row.evaluate(el=>el===document.activeElement));
 // Existing queue actions still submit exactly one song.
 for(const [label,position] of [["Play next","up_next"],["Add to queue","end"]]){
  await page.waitForFunction(()=>!document.querySelector(".libraryTrackPlay")?.disabled);
  await row.click({button:"right"});
  await page.getByRole("menuitem",{name:label,exact:true}).click();
  await menu.waitFor({state:"detached"});
  assert.equal(queues.at(-1).position,position);
  assert.equal(queues.at(-1).fileIds.length,1);
 }
 await page.getByRole("button",{name:"Lists",exact:true}).click();
 await page.getByRole("button",{name:/Collection 23/}).click();
 const playlistRow=page.locator(".playlistWorkspaceTrack").first();
 await playlistRow.waitFor();await page.waitForTimeout(500);
 await open(playlistRow);
 await search.fill("Morning");
 await menu.getByRole("button",{name:/Morning favorites/}).click();
 await page.getByRole("status").filter({hasText:"Added to Morning favorites"}).waitFor();
 assert.equal(writes.at(-3).body.fileIds[0],file.id);
 await page.keyboard.press("Escape");await page.keyboard.press("Escape");await menu.waitFor({state:"detached"});
 for(const width of [1440,650,360]){
  await page.setViewportSize({width,height:600});await page.waitForTimeout(250);
  await playlistRow.dispatchEvent("contextmenu",{clientX:width-2,clientY:598,bubbles:true});
  await page.getByRole("menuitem",{name:"Add to playlist",exact:true}).click();
  await search.waitFor();await page.waitForTimeout(300);
  const bounds=await menu.boundingBox();
  assert(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width&&bounds.y+bounds.height<=600);
  await page.screenshot({path:".music-os/song-playlist-qa/dark-"+width+".png"});
  await page.keyboard.press("Escape");await page.keyboard.press("Escape");await menu.waitFor({state:"detached"});
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole("button",{name:"Switch to saved light appearance"}).click();await page.waitForTimeout(400);
 await open(playlistRow);await page.waitForTimeout(300);
 assert(await menu.evaluate(el=>!!el.closest(".theme-light")));
 await page.screenshot({path:".music-os/song-playlist-qa/light.png"});
 await page.keyboard.press("Escape");await page.keyboard.press("Escape");await menu.waitFor({state:"detached"});
 await page.emulateMedia({reducedMotion:"reduce"});
 await playlistRow.focus();await page.keyboard.press("Shift+F10");
 assert.equal(await menu.evaluate(el=>getComputedStyle(el).transitionDuration),"0s");
 await page.mouse.click(5,590);await menu.waitFor({state:"detached"});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,playlistAdds:5,queueActions:queues.length,search:true,duplicate:true,failedSaveRetry:true,keyboard:true,scroll:true,themes:["dark","light"],widths:[1440,650,360],reducedMotion:true,errors}));
} finally {await browser.close();}
