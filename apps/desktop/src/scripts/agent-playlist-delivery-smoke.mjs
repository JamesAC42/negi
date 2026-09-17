// Isolated delivery fixture: intercept every mutation; no downloads, playback or library edits.
import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const now=new Date().toISOString();
const thread={id:"delivery-fixture",title:"A little sunshine for your library",status:"active",createdAt:now,updatedAt:now};
const titles=["Satellite","Lump","Oh Nina","Sell Out","Dope Nose","Radiation Vibe","That Thing You Do!","The King Is Half-Undressed","Seventh Heaven","Animal Spirits","Run Away With Me","Everybody's Lonely","Could Have Been Me","True Believers","Flamingo","Pool Party"];
const response={runId:"delivery-run",threadId:thread.id,reply:"I found a bright, high-energy mix. Your available tracks will be saved even if a source falls through.",intent:"research_playlist",searchQuery:"high-energy optimistic pop",results:["Every Morning","Seventh Heaven","Animal Spirits","Future Me Hates Me"].map((title,i)=>({fileId:"local-"+i,title,artist:["Sugar Ray","Beck","Vulfpeck","The Beths"][i],album:["14:59","Colors","The Beautiful Game","Future Me Hates Me"][i],year:null})),discoveryResults:titles.map((title,i)=>({discoveryId:"source-"+i,username:"music-source",filename:(i+1)+" - "+title+".flac",folder:"Music",sizeBytes:20000000,extension:"flac",isLocked:false,ownedMatchCount:0})),parsedListItems:[],importResults:[],playback:null,operationBatch:{id:"delivery-batch",source:"agent",status:"applied",summary:"Create researched playlist Sunshine on Full Blast",riskLevel:"low",agentThreadId:thread.id,operations:[]},researchSources:[{title:"AllMusic — Smash Mouth",url:"https://www.allmusic.com/artist/smash-mouth-mn0000029600",summary:"Bright alternative pop and ska influences."},{title:"Last.fm — related artists",url:"https://www.last.fm/music/Smash+Mouth",summary:"A starting point for energetic neighboring artists."}]};
const run={id:response.runId,threadId:thread.id,status:"completed",objective:"Make an optimistic playlist",response,error:null,createdAt:now,updatedAt:now,completedAt:now,steps:Array.from({length:26},(_,i)=>({id:"step-"+i,runId:response.runId,stepIndex:i,type:"tool",toolName:"catalog",status:"completed",summary:"Checked music source "+(i+1),input:null,output:null,error:null,createdAt:now,completedAt:now}))};
const messages=[{id:"user",threadId:thread.id,role:"user",text:"Make a playlist like Smash Mouth — high energy, optimistic. Any era.",response:null,createdAt:now},{id:"agent",threadId:thread.id,role:"agent",text:response.reply,response,createdAt:now}];
messages.push({id:"old-error",threadId:thread.id,role:"agent",text:"I could not finish Sunshine on Full Blast: a previous import failed.",response:null,createdAt:now});
let phase="waiting_for_import", polls=0, resumes=0;
const workflow=()=>({id:"delivery-workflow",runId:run.id,threadId:thread.id,operationBatchId:"delivery-batch",status:phase,playlistName:"Sunshine on Full Blast",playlistDescription:null,ownedFileIds:response.results.map(x=>x.fileId),downloadJobId:"download-fixture",importId:"import-fixture",importOperationBatchId:null,playlistOperationBatchId:null,playlistId:phase==="partial"?"playlist-fixture":null,error:phase==="waiting_for_import"?null:"18 of 20 requested tracks are ready; 2 still missing.",delivery:{readyTrackCount:phase==="waiting_for_import"?4:18,requestedTrackCount:20,missingTrackCount:phase==="waiting_for_import"?16:2,pendingImportCount:0,tracks:[...response.results.map(x=>({fileId:x.fileId,discoveryId:null,state:"owned"})),...response.discoveryResults.map((x,i)=>({discoveryId:x.discoveryId,fileId:i===7||i===10?null:"imported-"+i,state:phase==="waiting_for_import"?"pending":i===7||i===10?"missing":"imported"}))]},createdAt:now,updatedAt:now,completedAt:phase==="waiting_for_import"?null:now});
const counts={files:0,albums:0,playlists:0}, errors=[],writes=[];
const browser=await chromium.launch({...(process.platform==="win32"?{channel:"msedge"}:{}),headless:true});
await mkdir(".dream-loop",{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(12000);
 page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/127.0.0.1:47831/**",async r=>{
  const path=new URL(r.request().url()).pathname;
  if(path==="/library/files")counts.files++;
  if(path==="/library/albums")counts.albums++;
  if(path==="/playlists")counts.playlists++;
  if(path.startsWith("/agent/threads"))return r.fulfill({json:path==="/agent/threads"?{threads:[thread]}:{thread,messages}});
  if(path.startsWith("/agent/runs/"))return r.fulfill({json:{run}});
  if(path==="/agent/playlist-workflows"){polls++;return r.fulfill({json:{workflows:[workflow()]}});}
  if(path==="/agent/playlist-workflows/delivery-workflow/resume"){resumes++;phase="partial";return r.fulfill({json:{workflows:[workflow()]}});}
  if(path==="/discovery/downloads")return r.fulfill({json:{jobs:[]}});
  if(!["GET","HEAD","OPTIONS"].includes(r.request().method())){writes.push(path);return r.fulfill({status:409,json:{message:"Fixture prevents mutation"}});}
  return r.continue();
 });
 await page.goto(process.env.MUSIC_OS_RENDERER_URL || "http://127.0.0.1:5173");
 await page.getByRole("button",{name:"Agent",exact:true}).click();
 await page.locator(".agentHistoryList button").filter({hasText:thread.title}).click();
 const card=page.getByRole("region",{name:"Playlist delivery"});
 await card.getByText("4 of 20 tracks ready",{exact:true}).waitFor();
 assert.equal(await card.locator(".agentDeliveryTrack").count(),0,"collapsed tracks are not mounted");
 const before={...counts}; phase="failed";
 await card.getByText("18 of 20 tracks ready",{exact:true}).waitFor();

 for(let i=0;i<30 && !(counts.files>before.files && counts.albums>before.albums && counts.playlists>before.playlists);i++)await page.waitForTimeout(100);
 assert(counts.files>before.files && counts.albums>before.albums && counts.playlists>before.playlists,JSON.stringify({before,counts}));
 await page.waitForTimeout(700); const terminalPolls=polls; await page.waitForTimeout(3500);assert.equal(polls,terminalPolls,"failed terminal workflow stops polling");
 await card.getByRole("button",{name:"Recover available tracks"}).click();
 await card.getByText("Ready with gaps",{exact:true}).waitFor(); assert.equal(resumes,1);
 assert.equal(await page.locator(".agentDeliveryHistoryIssue > p").isVisible(),false,"raw historical errors stay collapsed");
 assert(await card.getByRole("button",{name:"Open playlist",exact:true}).isVisible());
 await card.scrollIntoViewIfNeeded();await page.screenshot({path:".dream-loop/playlist-card.png"});
 const disclosure=card.locator(".agentDeliveryDisclosure > summary");await disclosure.focus();await page.keyboard.press("Enter");
 await card.locator(".agentDeliveryTrack").last().waitFor();assert.equal(await card.locator(".agentDeliveryTrack").count(),20);
 assert.equal(await card.locator(".agentDeliveryTrackBadge.missing").count(),2);
 assert.equal(await card.locator(".agentDeliveryTrackBadge.imported").count(),14);
 await card.locator(".agentDeliveryNested > summary").filter({hasText:"Research sources"}).click();
 assert.equal(await card.locator(".agentDeliverySources a").count(),2);
 await card.locator(".agentDeliveryDisclosure > summary").scrollIntoViewIfNeeded();await page.screenshot({path:".dream-loop/playlist-expanded.png"});
 await disclosure.click();
 for(const width of [650,390]){
  await page.setViewportSize({width,height:900});await card.scrollIntoViewIfNeeded();
  const overflow=await card.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,right:el.getBoundingClientRect().right}));
  assert(overflow.scroll<=overflow.width+1 && overflow.right<=width,JSON.stringify({width,overflow}));
  await page.screenshot({path:".dream-loop/playlist-"+width+".png"});
 }
 await page.setViewportSize({width:1600,height:1000});await page.emulateMedia({reducedMotion:"reduce"});
 await page.evaluate(()=>{const key="music-os:appearance:v2";const settings=JSON.parse(localStorage.getItem(key));settings.mode="light";localStorage.setItem(key,JSON.stringify(settings));});
 await page.reload();await page.getByRole("button",{name:"Agent",exact:true}).click();await page.locator(".agentHistoryList button").filter({hasText:thread.title}).click();
 await card.getByText("Ready with gaps",{exact:true}).waitFor();await card.scrollIntoViewIfNeeded();
 await page.screenshot({path:".dream-loop/playlist-light.png"});
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 console.log(JSON.stringify({ok:true,refreshCounts:counts,resumes,tracks:20,errors,unexpectedWrites:writes}));
}finally{await browser.close();}
