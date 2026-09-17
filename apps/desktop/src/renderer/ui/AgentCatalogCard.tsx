import { useEffect, useState } from "react";
import { ArrowRight, Check, CheckCircle2, CircleHelp, Disc3, Download, ListChecks, XCircle } from "lucide-react";
import type { AcquisitionJob, AgentCatalogPlan, AgentRun } from "@music-os/core";
import { exploreApi } from "./explore-api";
import type { CatalogAction } from "./AgentWorkspace";

export function AgentCatalogCard({ plan, runId, disabled, onChoose }: {
  plan: AgentCatalogPlan; runId: string | undefined; disabled: boolean;
  onChoose(message: string, action: CatalogAction): Promise<void>;
}) {
  const [jobs, setJobs] = useState<AcquisitionJob[]>([]);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const ids = plan.jobIds.join(",");
  useEffect(() => {
    if (!ids) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (document.hidden) { timer=setTimeout(poll,3000); return; }
      try {
        const result=await exploreApi<{jobs:AcquisitionJob[]}>(`/agent/catalog/jobs?ids=${encodeURIComponent(ids)}`,undefined,controller.signal);
        if(controller.signal.aborted)return;
        setJobs(result.jobs);setError("");
        if(result.jobs.length < plan.jobIds.length || result.jobs.some(job=>job.status==="queued" || job.status==="running")) timer=setTimeout(poll,2500);
      } catch(e) { if(!controller.signal.aborted)setError(e instanceof Error?e.message:String(e)); }
    };
    void poll();
    return()=>{controller.abort();if(timer)clearTimeout(timer);};
  },[ids,retry]);
  const done=jobs.length===plan.jobIds.length && jobs.length>0 && jobs.every(job=>job.status==="succeeded");
  const failed=jobs.some(job=>job.status==="failed" || job.status==="cancelled");
  const label=done?"Downloads complete":failed?"Needs attention":plan.status==="clarification"?"A quick choice":plan.status==="review"?"Ready for your review":plan.status==="queued"?"Download progress":"Result";
  const Icon=done?CheckCircle2:failed?XCircle:plan.status==="clarification"?CircleHelp:plan.status==="review"?ListChecks:plan.status==="queued"?Download:CheckCircle2;
  return <section className="agentPlan" aria-label={label}>
    <header><Icon size={20}/><div><small>{label}</small><strong>{plan.title}</strong></div></header>
    {plan.summary && <p>{plan.summary}</p>}
    {plan.items.length>0 && <div className="agentPlanItems" aria-label="Catalog results">{plan.items.map(item=><article className="agentPlanItem" key={item.id}>
      <span className="agentPlanArt">{item.artworkUrl?<img src={item.artworkUrl} alt="" loading="lazy" onError={e=>{e.currentTarget.style.display="none";}}/>:<Disc3 size={20}/>}</span>
      <div><strong>{item.title}</strong><small>{item.artist}{item.date ? ` · ${item.date.slice(0,4)}` : ""}{item.provider ? ` · ${item.provider==="apple"?"Apple Music":"MusicBrainz"}` : ""}</small>{item.detail && <small>{item.detail}</small>}</div>
      <small>{item.libraryStatus==="complete"?"In library":item.libraryStatus==="partial"?`${item.ownedTracks ?? 0} owned`:item.kind}</small>
    </article>)}</div>}
    {plan.notes.length>0 && <div className="agentPlanNotes">{plan.notes.map((note,i)=><div key={i}>{note}</div>)}</div>}
    {jobs.map(job=><div className="agentJob" key={job.id}><div><strong>{job.artist} — {job.album}</strong><span>{job.status==="succeeded"?"Complete":job.status}</span></div><progress max={1} value={Math.max(0,Math.min(1,job.progress))} aria-label={`Download progress for ${job.album}`}/><small role={job.error?"alert":undefined}>{job.error || job.message}</small></div>)}
    {error && <div className="agentPlanNotes" role="alert">Progress unavailable: {error} <button type="button" onClick={()=>setRetry(n=>n+1)}>Retry</button></div>}
    {plan.choices.length>0 && <div className="agentPlanChoices">{plan.choices.map(choice=><button disabled={disabled || !runId} type="button" key={choice.id} onClick={()=>{if(runId)void onChoose(choice.label,{runId,choiceId:choice.id});}}><span><strong>{choice.label}</strong><small>{choice.description}</small></span><ArrowRight size={16}/></button>)}</div>}
    {disabled && plan.choices.length>0 && <p className="agentMuted">Continue with the latest response below.</p>}
  </section>;
}

export function AgentActivityTrace({run}:{run:AgentRun}) {
  const completed=run.steps.filter(step=>step.status==="completed").length;
  return <details className="agentTrace"><summary>{run.status==="failed"?"Request failed":"Activity"} · {completed}/{run.steps.length} steps complete</summary><div className="agentTraceSteps">{run.steps.map(step=><div className={`agentTraceStep ${step.status}`} key={step.id}>
    {step.status==="failed"?<XCircle size={14}/>:<Check size={14}/>}<span>{step.summary}{step.error && <small>{step.error}</small>}</span>
  </div>)}</div></details>;
}
