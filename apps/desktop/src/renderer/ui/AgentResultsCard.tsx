import { useState, type ReactNode } from "react";
import { ArrowRight, Check, ChevronDown, CircleAlert, Disc3, Download, LibraryBig, ListMusic, RotateCcw } from "lucide-react";
import type { AgentMessageResponse, AgentPlaylistWorkflow, AgentRun } from "@music-os/core";
import { AgentActivityTrace } from "./AgentCatalogCard";
import "./agent-results-card.css";

export function AgentResultsCard({response,run,workflow,onOpenPlaylist,onOpenOperations,onApprove,onApply,onRecover}:{
 response:AgentMessageResponse;run?:AgentRun|null;workflow?:AgentPlaylistWorkflow;
 onOpenPlaylist(id:string):void|Promise<void>;onOpenOperations():void;
 onApprove(id:string):Promise<void>;onApply(id:string):Promise<void>;onRecover(id:string):Promise<void>;
}) {
 const [expanded,setExpanded]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const batch=response.operationBatch;
 const playlistId=workflow?.playlistId ?? response.playlistId;
 const isPlaylist=response.intent==="research_playlist" || response.intent==="propose_playlist" || Boolean(workflow);
 const localCount=response.results.length;
 const downloadCount=response.discoveryResults.length;
 const requested=workflow?.delivery?.requestedTrackCount ?? localCount+downloadCount;
 const ready=workflow?.delivery?.readyTrackCount ?? localCount;
 const missing=workflow?.delivery?.missingTrackCount ?? 0;
 const pending=workflow?.delivery?.pendingImportCount ?? 0;
 const status=workflow?.status;
 const active=status && !["completed","partial","failed"].includes(status);
 const title=workflow?.playlistName ?? (isPlaylist ? batch?.summary.replace(/^Create (?:researched )?playlist\s*/i,"") || "Your playlist" : "Music results");
 const label=status==="partial"?"Ready with gaps":status==="completed"?"Playlist ready":status==="failed"?"Needs attention":status==="waiting_for_import"?"Importing tracks":status==="creating_playlist"?"Building playlist":status==="waiting_for_download"?"Finding your music":batch?.status==="applied"?"Request started":batch?.status==="approved"?"Ready to apply":batch?.status==="proposed"?"Ready for review":"Results";
 const deliveryTracks=workflow?.delivery?.tracks;
 const sourceCount=response.researchSources?.length ?? 0;
 const showBatch=batch && ["draft","proposed","approved","failed","partially_applied"].includes(batch.status);
 async function action(work:()=>Promise<void>){setBusy(true);setError("");try{await work();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 const hasContent=Boolean(requested || sourceCount || response.discoveryGroups?.length || response.importResults.length || response.parsedListItems.length || run?.steps.length || workflow?.error || showBatch || playlistId);
 if(!hasContent)return null;
 return <section className="agentDeliveryCard" aria-label={isPlaylist?"Playlist delivery":"Music results"}>
  <header><span className="agentDeliveryIcon">{isPlaylist?<ListMusic size={21}/>:<Disc3 size={21}/>}</span><div><span className="agentDeliveryEyebrow">{isPlaylist?"YOUR PLAYLIST":"MUSIC RESULTS"}</span><h3>{title}</h3><p>{isPlaylist && requested ? `${ready} of ${requested} tracks ready` : `${requested || response.importResults.length || response.parsedListItems.length} matches`}</p></div><span className={`agentDeliveryBadge ${status==="partial" || status==="failed"?"attention":""}`}>{status==="completed"?<Check size={12}/>:status==="partial" || status==="failed"?<CircleAlert size={12}/>:null}{label}</span></header>
  {isPlaylist && requested>0 && <div className="agentDeliveryProgress"><progress aria-label="Playlist tracks ready" max={Math.max(requested,1)} value={Math.min(ready,requested)}/><div><span><LibraryBig size={12}/>{localCount} from your library</span><span><Download size={12}/>{Math.max(0,ready-localCount)} imported</span>{missing>0 && <span className="agentDeliveryWarning">{missing} not ready</span>}{active && <span role="status">Updating automatically</span>}</div></div>}
  {(playlistId || showBatch || (workflow && (status==="failed" || pending>0))) && <div className="agentDeliveryActions">
   {playlistId && <button className="agentDeliveryPrimary" type="button" onClick={()=>void onOpenPlaylist(playlistId)}>Open playlist <ArrowRight size={13}/></button>}
   {workflow && (status==="failed" || pending>0) && <button type="button" disabled={busy || Boolean(active)} onClick={()=>void action(()=>onRecover(workflow.id))}><RotateCcw size={12}/>{busy?"Recovering…":playlistId?"Retry pending imports":"Recover available tracks"}</button>}
   {showBatch && <><button type="button" onClick={onOpenOperations}>Review operation</button>{["draft","proposed"].includes(batch.status) && <button disabled={busy} type="button" onClick={()=>void action(()=>onApprove(batch.id))}>Approve</button>}{batch.status==="approved" && <button disabled={busy || !batch.operations.length} type="button" onClick={()=>void action(()=>onApply(batch.id))}>Apply</button>}</>}
  </div>}
  {error && <p className="agentDeliveryError" role="alert">{error}</p>}
  <details className="agentDeliveryDisclosure" onToggle={e=>setExpanded(e.currentTarget.open)}>
   <summary><ChevronDown size={14}/><strong>Tracks & sources</strong><span>{sourceCount? `Research · ${sourceCount}`:""}{run?.steps.length ? `  Activity · ${run.steps.length}`:""}</span></summary>
   {expanded && <div className="agentDeliveryBody">
    {workflow?.error && <details className="agentDeliveryIssue"><summary><CircleAlert size={13}/>{missing ? `${missing} tracks are not ready`:"Delivery needs attention"}<ChevronDown size={13}/></summary><p>{workflow.error}</p><small>Available tracks are kept. Recovery retries pending imports without downloading the collection again.</small></details>}
    {deliveryTracks && <ResultGroup title="Track list" count={deliveryTracks.length}>{deliveryTracks.map((track,index)=>{
     const local=response.results.find(item=>item.fileId===track.fileId);
     const source=response.discoveryResults.find(item=>item.discoveryId===track.discoveryId);
     return <ResultRow key={track.discoveryId ?? track.fileId ?? index} number={index+1}
      title={local?.title ?? (source?cleanFilename(source.filename):"Requested track")}
      subtitle={local?[local.artist,local.album].filter(Boolean).join(" · "):[source?.folder?.split(/[\\/]/).at(-1),source?.extension?.toUpperCase()].filter(Boolean).join(" · ")}
      state={track.state} badge={{owned:"In library",imported:"Imported",pending:"Pending import",missing:"Not ready"}[track.state]}/>;
    })}</ResultGroup>}
    {!deliveryTracks && response.results.length>0 && <ResultGroup title="From your library" count={response.results.length}>{response.results.map((item,index)=><ResultRow key={item.fileId} number={index+1} title={item.title} subtitle={[item.artist,item.album].filter(Boolean).join(" · ")} badge="In library"/>)}</ResultGroup>}
    {!deliveryTracks && downloadCount>0 && <ResultGroup title="Requested downloads" count={downloadCount}><p className="agentDeliveryNote">Planned sources are shown below. The delivery summary above reports what reached your library.</p>{response.discoveryResults.map((item,index)=><ResultRow key={item.discoveryId} number={localCount+index+1} title={cleanFilename(item.filename)} subtitle={[item.username,item.extension?.toUpperCase()].filter(Boolean).join(" · ")} badge={item.isLocked?"Locked source":"Selected source"}/>)}</ResultGroup>}
    {Boolean(response.discoveryGroups?.length) && <details className="agentDeliveryNested"><summary>Source albums <span>{response.discoveryGroups!.length}</span><ChevronDown size={13}/></summary>{response.discoveryGroups!.map((group,index)=><ResultRow key={index} title={group.releaseTitle} subtitle={group.releaseArtist || "Unknown artist"} badge={`${group.sourceCount} source${group.sourceCount===1?"":"s"}`}/>)}</details>}
    {response.parsedListItems.length>0 && <ResultGroup title="Parsed tracks" count={response.parsedListItems.length}>{response.parsedListItems.map((item,index)=><ResultRow key={index} number={item.rank ?? index+1} title={item.title} subtitle={item.artist || item.query} badge={`${item.ownedMatchCount} owned`}/>)}</ResultGroup>}
    {response.importResults.length>0 && <ResultGroup title="Import results" count={response.importResults.length}>{response.importResults.map(item=><ResultRow key={item.importItemId} title={item.title || "Untitled"} subtitle={[item.artist,item.album].filter(Boolean).join(" · ")} badge={`${item.duplicateCount} duplicates`}/>)}</ResultGroup>}
    {sourceCount>0 && <details className="agentDeliveryNested"><summary>Research sources <span>{sourceCount}</span><ChevronDown size={13}/></summary><div className="agentDeliverySources">{response.researchSources!.map(source=><a href={source.url} key={source.url} target="_blank" rel="noreferrer"><strong>{source.title}<ArrowRight size={12}/></strong>{source.summary && <small>{source.summary}</small>}</a>)}</div></details>}
    {run && run.steps.length>0 && <AgentActivityTrace run={run}/>}
   </div>}
  </details>
 </section>;
}
function ResultGroup({title,count,children}:{title:string;count:number;children:ReactNode}){return <section className="agentDeliveryGroup"><h4>{title}<span>{count}</span></h4>{children}</section>;}
function ResultRow({number,title,subtitle,badge,state}:{number?:number;title:string;subtitle:string;badge:string;state?:string}){return <div className="agentDeliveryTrack">{number!=null&&<span className="agentDeliveryTrackNumber">{String(number).padStart(2,"0")}</span>}<div><strong>{title}</strong><small>{subtitle}</small></div><span className={`agentDeliveryTrackBadge ${state ?? ""}`}>{badge}</span></div>;}
function cleanFilename(value:string){return value.split(/[\\/]/).at(-1)!.replace(/\.(flac|mp3|m4a|aiff?|wav|ogg|opus|alac)$/i,"").replace(/^\d{1,3}[. _-]+/,"");}
