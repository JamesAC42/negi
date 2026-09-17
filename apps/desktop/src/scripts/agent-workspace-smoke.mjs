// Safe renderer fixture: all agent writes are intercepted; no paid calls or downloads.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin=process.env.MUSIC_OS_RENDERER_URL || "http://127.0.0.1:5173";
const api=process.env.MUSIC_OS_BACKEND_URL || "http://127.0.0.1:47831";
const now=new Date().toISOString();
const thread={id:"agent-ui-fixture",title:"A collection worth completing",status:"active",createdAt:now,updatedAt:now};
const artist={id:"apple:fixture",kind:"album",artist:"The Example Band",title:"A beautifully long album title",provider:"apple",date:"2025-03-01",libraryStatus:"partial",ownedTracks:3};
const choice=(id,label,kind)=>({id,label,description:"Verified catalog identity. Review the missing tracks before downloading.",action:{kind,capability:"album",artist:"The Example Band",artistId:"apple:fixture"}});
const plans=[
{capability:"album",title:"Which artist did you mean?",summary:"Choose the matching catalog artist.",status:"clarification",choices:[choice("artist-1","The Example Band","releases")],items:[],notes:["Your saved quality preferences will apply."],jobIds:[]},
{capability:"album",title:"Review your download",summary:"One album, with existing tracks preserved.",status:"review",choices:[choice("queue-1","Download missing tracks","queue")],items:[artist],notes:["3 tracks already in your library.","Prefers lossless audio."],jobIds:[]},
{capability:"album",title:"Added to your library queue",summary:"The verified release is downloading.",status:"queued",choices:[],items:[artist],notes:[],jobIds:["job-fixture"]}
];
plans.push({capability:"track",title:"Song ready in Operations",summary:"Review and apply this song download.",status:"review",choices:[],items:[{...artist,kind:"track"}],notes:[],jobIds:[]});
let batch={id:"song-batch",source:"agent",status:"proposed",summary:"Download one song",riskLevel:"low",agentThreadId:thread.id,operations:[{id:"song-operation",batchId:"song-batch",type:"queue_download",status:"proposed",payload:{},before:null,after:null,error:null}]};
const writes=[], errors=[], unexpectedWrites=[], operationWrites=[], runs=new Map();
let threadMessages=[];
let jobPolls=0, allowProgress=false, successfulPolls=0;
const browser=await chromium.launch({...(process.platform==="win32"?{channel:"msedge"}:{}),headless:true,args:["--no-sandbox"]});
await mkdir(".dream-loop",{recursive:true});
try {
const page=await browser.newPage({viewport:{width:1600,height:1000}});
// React's profiling hook measures which components actually render per keystroke.
await page.addInitScript(() => {
 window.agentTypingRenders={}; window.measureAgentTyping=false;
 window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,renderers:new Map(),
  inject(renderer){this.renderers.set(1,renderer);return 1;},onCommitFiberUnmount(){},
  onCommitFiberRoot(_id,root){
   function visit(fiber){
    if(!fiber)return;
    const name=fiber.type?.displayName || fiber.type?.name || fiber.type?.render?.name;
    if(["App","AgentWorkspace","AgentComposer"].includes(name)){
     // PerformedWork distinguishes actual rendering from ancestor traversal.
     if(window.measureAgentTyping && (fiber.flags & 1)!==0)window.agentTypingRenders[name]=(window.agentTypingRenders[name]||0)+1;
    }
    visit(fiber.child);visit(fiber.sibling);
   }
   visit(root.current);
  }
 };
});
page.setDefaultTimeout(12000);
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/127.0.0.1:47831/**", async r=>{
 const path=new URL(r.request().url()).pathname;
 if(path.startsWith("/agent/threads"))return r.fulfill({json:path==="/agent/threads"&&r.request().method()==="GET"?{threads:[thread]}:{thread,messages:threadMessages}});
 if(path.startsWith("/agent/runs/"))return r.fulfill({json:{run:runs.get(path.split("/").at(-1))}});
 if(path==="/operations/batches")return r.fulfill({json:{batches:[batch]}});
 if(path==="/operations/approve-batch" || path==="/operations/apply-batch") {
   operationWrites.push(path);
   const status=path.endsWith("approve-batch")?"approved":"applied";
   batch={...batch,status,operations:batch.operations.map(operation=>({...operation,status}))};
   return r.fulfill({json:{batch}});
 }
 if(path==="/agent/runs"&&r.request().method()==="POST"){
  const body=r.request().postDataJSON();writes.push(body);
  const index=writes.length-1;
  const response={threadId:thread.id,runId:"run-"+index,reply:plans[index].summary,intent:"catalog",searchQuery:"fixture",results:[],discoveryResults:[],parsedListItems:[],importResults:[],operationBatch:index===3?batch:null,playback:null,catalogPlan:plans[index]};
  await new Promise(resolve=>setTimeout(resolve,350));
  const run={id:"run-"+index,threadId:thread.id,status:"completed",objective:body.message,response,error:null,createdAt:now,updatedAt:now,completedAt:now,steps:[{id:"step-"+index,runId:"run-"+index,stepIndex:0,type:"tool",toolName:"catalog",status:"completed",summary:"Verified catalog identity",input:null,output:null,error:null,createdAt:now,completedAt:now}]};
  runs.set(run.id,run);
  threadMessages.push({id:"user-"+index,threadId:thread.id,role:"user",text:body.message,response:null,createdAt:now},{id:"agent-"+index,threadId:thread.id,role:"agent",text:response.reply,response,createdAt:now});
  return r.fulfill({json:{run}});
 }
 if(path==="/agent/catalog/jobs"){
  jobPolls++;
  if(!allowProgress)return r.fulfill({status:503,json:{message:"Fixture temporary progress failure"}});
  successfulPolls++; return r.fulfill({json:{jobs:[{id:"job-fixture",status:successfulPolls>1?"succeeded":"running",progress:successfulPolls>1?1:.45,artist:"The Example Band",album:artist.title,message:successfulPolls>1?"Imported verified tracks":"Downloading 4 of 9 tracks",error:null,createdAt:now}]}});
 }
 if(!["GET","HEAD","OPTIONS"].includes(r.request().method())){unexpectedWrites.push(path);return r.fulfill({status:409,json:{message:"Unexpected fixture mutation"}});}
 return r.continue();
});
await page.goto(origin);
await page.getByRole("button",{name:"Agent",exact:true}).click();
await page.locator(".agentCapabilityGrid > button").last().waitFor();
assert.equal(await page.locator(".agentCapabilityGrid > button").count(),10);
const composer=page.getByRole("textbox",{name:"Agent message"});
await page.waitForTimeout(500);
await composer.focus();
await page.evaluate(()=>{window.measureAgentTyping=true;window.agentTypingRenders={};});
const typingStart=Date.now();
const typedDraft="Find me some upbeat guitar music for a sunny afternoon, with plenty of catchy melodies.";
await page.keyboard.type(typedDraft);
const typingMs=Date.now()-typingStart;
const typingRenders=await page.evaluate(()=>{window.measureAgentTyping=false;return window.agentTypingRenders;});
assert.equal(await composer.inputValue(),typedDraft);
assert((typingRenders.AgentComposer||0)>=typedDraft.length,"profiling sees local composer updates");
assert((typingRenders.App||0)<5 && (typingRenders.AgentWorkspace||0)<5,JSON.stringify({typingRenders}));
await page.getByRole("button",{name:"Home",exact:true}).click();
await page.getByRole("button",{name:"Agent",exact:true}).click();
assert.equal(await composer.inputValue(),typedDraft,"draft survives page unmount/remount");
await composer.fill("first");await composer.press("Shift+Enter");await page.keyboard.type("second");
assert.equal(await composer.inputValue(),"first\nsecond","Shift+Enter adds a newline");
await composer.evaluate(el=>el.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,isComposing:true})));
assert.equal(writes.length,0,"IME Enter does not submit");
await composer.fill("   ");assert(await page.getByRole("button",{name:"Send message"}).isDisabled());

for(let i=0;i<10;i++){await page.locator(".agentCapabilityGrid > button").nth(i).click();assert((await page.getByRole("textbox",{name:"Agent message"}).inputValue()).length>5);}
assert.equal(writes.length,0,"starters prepare a prompt without sending");
await page.getByRole("textbox",{name:"Agent message"}).fill("Download the album Example by The Example Band");
await page.getByRole("textbox",{name:"Agent message"}).press("Enter");
await page.getByRole("status").filter({hasText:"Working on your request"}).waitFor();
await page.getByRole("button",{name:/The Example Band Verified/}).click();
assert.deepEqual(writes[1].catalogAction,{runId:"run-0",choiceId:"artist-1"});
await page.getByRole("button",{name:/Download missing tracks Verified/}).waitFor();
assert(await page.getByRole("button",{name:/The Example Band Verified/}).isDisabled());
await page.screenshot({path:".dream-loop/agent-review.png"});
await page.getByRole("button",{name:/Download missing tracks Verified/}).click();
assert.deepEqual(writes[2].catalogAction,{runId:"run-1",choiceId:"queue-1"});
assert.equal(writes[2].threadId,thread.id);
await page.getByRole("alert").filter({hasText:"Progress unavailable"}).waitFor();
allowProgress=true; await page.getByRole("button",{name:"Retry",exact:true}).click();
await page.getByText("Downloading 4 of 9 tracks",{exact:true}).waitFor();
await page.screenshot({path:".dream-loop/agent-progress.png"});
await page.getByText("Downloads complete",{exact:true}).waitFor();
const polls=jobPolls;await page.waitForTimeout(2800);assert.equal(jobPolls,polls,"terminal jobs stop polling");
await page.getByRole("textbox",{name:"Agent message"}).fill("Find the song Example by Example Band");
await page.getByRole("textbox",{name:"Agent message"}).press("Enter");
await page.getByRole("button",{name:"Approve",exact:true}).click();
await page.waitForFunction(()=>[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Apply"&&!b.disabled));
assert.equal(await page.getByRole("button",{name:"Approve",exact:true}).count(),0);
await page.getByRole("button",{name:"Apply",exact:true}).click();
await page.getByText("Request started",{exact:true}).waitFor();
assert.deepEqual(operationWrites,["/operations/approve-batch","/operations/apply-batch"]);
await page.getByRole("button",{name:/Explore tasks/}).click();
await page.getByRole("button",{name:/View taste profile/}).click();
await page.getByRole("region",{name:"Learned listening preferences"}).waitFor();
await page.locator(".learnedTastePanel").scrollIntoViewIfNeeded();
await page.screenshot({path:".dream-loop/taste-profile.png"});
await page.getByRole("button",{name:"Agent",exact:true}).click();
for(const width of [1100,650,390]){
 await page.setViewportSize({width,height:900});
 await page.locator(".agentCapabilityGrid > button").last().scrollIntoViewIfNeeded();
 assert(await page.getByRole("textbox",{name:"Agent message"}).isVisible());
 const overflow=await page.locator(".agentWorkspace").evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth}));
 assert(overflow.scroll<=overflow.client+1,JSON.stringify({width,overflow}));
 assert(await page.getByRole("button",{name:"Send message"}).evaluate(el=>el.getBoundingClientRect().right<=window.innerWidth),"composer submit stays inside viewport");
 await page.screenshot({path:`.dream-loop/agent-${width}.png`});
}
await page.setViewportSize({width:1600,height:1000});
await page.emulateMedia({reducedMotion:"reduce"});
await page.getByRole("button",{name:/Switch to light|Light mode|Toggle theme|light theme/i}).click().catch(async()=>{
 await page.evaluate(()=>{const k="music-os:appearance:v2";const v=JSON.parse(localStorage.getItem(k));if(v){v.mode="light";localStorage.setItem(k,JSON.stringify(v));}});
 await page.reload();await page.getByRole("button",{name:"Agent",exact:true}).click();
});
await page.locator(".agentCapabilityGrid > button").last().waitFor();
await page.screenshot({path:".dream-loop/agent-light.png"});
assert.deepEqual(errors,[]);
assert.deepEqual(unexpectedWrites,[]);
const frameIntervals=await page.evaluate(()=>new Promise(resolve=>{const samples=[];let last=performance.now();function frame(t){samples.push(t-last);last=t;if(samples.length<90)requestAnimationFrame(frame);else resolve(samples.slice(2));}requestAnimationFrame(frame)}));
const frameP95=frameIntervals.sort((a,b)=>a-b)[Math.floor(frameIntervals.length*.95)];
console.log(JSON.stringify({typingMs,typingRenders,frameP95,operationWrites,ok:true,capabilities:10,catalogSubmissions:writes.length,jobPolls,responsiveWidths:[1600,1100,650,390],errors,unexpectedWrites}));
}finally{await browser.close();}
