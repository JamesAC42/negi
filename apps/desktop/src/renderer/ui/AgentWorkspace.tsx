import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Bot, Disc3, Download, LibraryBig, ListMusic, Music2, Plus, Search, Sparkles, Target, Users, CalendarDays } from "lucide-react";
import type { AgentMessageResponse, AgentRun, AgentThreadsResponse, TasteProfileResponse } from "@music-os/core";
import { exploreApi } from "./explore-api";
import "./agent-workspace.css";
import { AgentComposer, type AgentComposerHandle } from "./AgentComposer";

export type AgentWorkspaceMessage = { id: string; role: "user"; text: string } | { id: string; role: "agent"; text: string; response: AgentMessageResponse | null; run?: AgentRun | null };
type Capability = { id: string; title: string; description: string; prompt: string };
export type CatalogAction = { runId: string; choiceId: string };

const capabilityIcons = [Search, Download, Users, LibraryBig, Target, Users, Sparkles, ListMusic, CalendarDays, Disc3];

export function AgentWorkspace(props: {
  busy: boolean; draftRef: { current: string }; activeThreadId: string | null; messages: AgentWorkspaceMessage[];
  threads: AgentThreadsResponse["threads"]; taste: TasteProfileResponse | null;
  onNewThread(): Promise<void>; onSelectThread(id: string): Promise<void>;
  onSubmit(message: string): Promise<void>; onOpenTaste(): void; onOpenOperations(): void;
  renderResult(message: Extract<AgentWorkspaceMessage, { role: "agent" }>): ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [welcome, setWelcome] = useState(true);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [error, setError] = useState("");
  const [railError, setRailError] = useState("");
  const [loadingThread, setLoadingThread] = useState(false);
  const composerRef = useRef<AgentComposerHandle>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const activeThread = props.threads.find(t => t.id === props.activeThreadId);
  useEffect(() => {
    const controller = new AbortController();
    exploreApi<{ capabilities: Capability[] }>("/agent/capabilities", undefined, controller.signal)
      .then(result => setCapabilities(result.capabilities))
      .catch(e => { if (!controller.signal.aborted) setError(String(e.message || e)); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (follow.current && !welcome) {
      const node = transcriptRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    }
  }, [props.messages, props.busy, welcome]);
  async function selectThread(id?: string) {
    setLoadingThread(true); setRailError("");
    try {
      if (id) { await props.onSelectThread(id); setWelcome(false); }
      else { await props.onNewThread(); setWelcome(true); }
      follow.current = true;
    } catch (e) { setRailError(e instanceof Error ? e.message : String(e)); }
    finally { setLoadingThread(false); }
  }
  function prepare(prompt: string) {
    composerRef.current?.prepare(prompt);
  }
  const filtered = props.threads.filter(t => t.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <section className="agentWorkspace" aria-label="Agent">
    <aside className="agentHistory">
      <header><h1><Bot size={17} /> Agent</h1><button type="button" disabled={props.busy || loadingThread} onClick={() => void selectThread()}><Plus size={14} /> New chat</button></header>
      <label className="agentHistorySearch"><Search size={14} /><input aria-label="Search chats" placeholder="Search chats" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <div className="agentHistoryList">
        <div className="agentEyebrow"><span>CONVERSATIONS</span><span>{filtered.length}</span></div>
        {filtered.map(thread => <button type="button" key={thread.id} disabled={props.busy || loadingThread} aria-current={!welcome && thread.id === props.activeThreadId ? "true" : undefined} onClick={() => void selectThread(thread.id)}>
          <strong title={thread.title}>{thread.title}</strong><small>{new Date(thread.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small>
        </button>)}
        {!filtered.length && <p className="agentMuted">No matching conversations.</p>}
        {railError && <p role="alert" className="inlineError">{railError}</p>}
      </div>
      <footer><Bot size={13} /><span>Music, with a little direction.</span></footer>
    </aside>
    <section className="agentCanvas">
      {!welcome && <header className="agentChatHeader"><div><span className="agentEyebrow">MUSIC AGENT</span><h2>{activeThread?.title || "New conversation"}</h2></div><button type="button" onClick={() => setWelcome(true)}>Explore tasks <ArrowRight size={14} /></button></header>}
      <div className="agentScroll" ref={transcriptRef} onScroll={e => { const n=e.currentTarget; follow.current=n.scrollHeight-n.scrollTop-n.clientHeight<100; }}>
        {welcome ? <div className="agentWelcome">
          <header className="agentWelcomeHeader">
            <span className="agentWelcomeMark" aria-hidden="true"><span /></span>
            <div>
              <div className="agentEyebrow agentWelcomeEyebrow"><span>negi</span> MUSIC AGENT</div>
              <h2>Your music, a little further.</h2>
              <p className="agentWelcomeSubtitle">Find a song. Complete a collection. Discover what comes next.</p>
            </div>
          </header>
          <TasteSummary taste={props.taste} onOpen={props.onOpenTaste} />
          <section className="agentCapabilities" aria-label="Agent capabilities">
            <h3>What would you like to do?</h3>
            {error && <p role="alert" className="inlineError">Could not load request starters. You can still write a request below. {error}</p>}
            {!error && !capabilities.length && <p className="agentMuted" role="status">Loading request starters…</p>}
            <div className="agentCapabilityGrid">{capabilities.map((capability, index) => {
              const Icon = capabilityIcons[index % capabilityIcons.length]!;
              return <button type="button" key={capability.id} disabled={props.busy} onClick={() => prepare(capability.prompt)}><Icon size={23} /><span><strong>{capability.title}</strong><small>{capability.description}</small></span><ArrowRight size={16} /></button>;
            })}</div>
          </section>
        </div> : <div className="agentMessages" role="log" aria-label="Conversation">
          {!props.messages.length && <p className="agentMuted">Tell me what you would like to find.</p>}
          {props.messages.map(message => <article className={`agentTurn ${message.role}`} key={message.id}>
            <header><span className="agentTurnAvatar">{message.role === "agent" ? <Bot size={15} /> : "Y"}</span><strong>{message.role === "agent" ? "Music agent" : "You"}</strong></header>
            <div className="agentTurnBody">{message.role === "agent" && !message.response && message.text.startsWith("I could not finish ") ? <details className="agentDeliveryHistoryIssue"><summary>Playlist delivery issue <span>View details</span></summary><p>{message.text}</p></details> : !(message.role === "agent" && message.response?.catalogPlan?.summary === message.text) && <p>{message.text}</p>}{message.role === "agent" && props.renderResult(message)}</div>
          </article>)}
          {props.busy && <article className="agentTurn agent"><header><span className="agentTurnAvatar"><Bot size={15} /></span><strong>Music agent</strong></header><div className="agentThinking" role="status"><span className="t-shimmer" data-text="Working on your request">Working on your request</span><small>Checking your preferences and the available music tools.</small></div></article>}
        </div>}
      </div>
      <AgentComposer ref={composerRef} draftRef={props.draftRef} busy={props.busy}
        onSubmit={async message => { setWelcome(false); follow.current = true; await props.onSubmit(message); }}
        onOpenOperations={props.onOpenOperations} />
    </section>
  </section>;
}

function TasteSummary({taste,onOpen}:{taste:TasteProfileResponse|null;onOpen():void}) {
  const effective=taste?.effectiveProfile ?? taste?.profile;
  const picks=[
    ...(effective?.favoriteArtists ?? []).slice(0,2).map(value=>({value,label:"Artist affinity",icon:Users})),
    ...(effective?.preferredGenres ?? []).slice(0,1).map(value=>({value,label:"In your rotation",icon:Music2})),
    ...(effective?.favoriteAlbums ?? []).slice(0,3).map(value=>({value,label:"Favorite album",icon:Disc3}))
  ].slice(0,3);
  return <section className="agentTaste" aria-label="Taste context">
    <header><strong>TUNED TO YOU</strong><span>From your listening + saved preferences</span><button type="button" onClick={onOpen}>View taste profile <ArrowRight size={13}/></button></header>
    <div className="agentTastePicks">{picks.map((pick,index)=><div key={index}><span className="agentTasteIcon"><pick.icon size={20}/></span><span><strong>{pick.value}</strong><small>{pick.label}</small></span></div>)}</div>
    {!picks.length && <p className="agentMuted">{taste ? "Your profile grows as you listen, rate, and favorite music." : "Loading your listening profile…"}</p>}
  </section>;
}

export function LearnedTastePanel({taste}:{taste:TasteProfileResponse}) {
  const learned=taste.learned;
  if(!learned) return null;
  const groups=[["favoriteArtists","Artists"],["favoriteAlbums","Albums"],["favoriteTracks","Tracks"],["preferredGenres","Genres"],["preferredEras","Eras"],["preferredCountries","Countries"],["preferredLabels","Labels"]] as const;
  return <section className="learnedTastePanel" aria-label="Learned listening preferences">
    <header><div><span className="agentEyebrow">LEARNED FROM LISTENING</span><h3>A profile that grows with you.</h3><p>Listening and ratings inform discovery. Your saved choices below take priority.</p></div><span className="agentTasteTimestamp">{learned.updatedAt ? new Date(learned.updatedAt).toLocaleString() : "Waiting for listening evidence"}</span></header>
    <div className="learnedTasteStats"><span><strong>{learned.stats.qualifiedPlays}</strong> qualified plays</span><span><strong>{learned.stats.completedPlays}</strong> completions</span><span><strong>{learned.stats.earlySkips}</strong> early skips</span><span><strong>{learned.stats.likedTracks}</strong> liked tracks</span></div>
    <div className="learnedTasteGroups">{groups.map(([key,label])=>{
      const signals=learned.signals.filter(signal=>signal.key===key).slice(0,6);
      return <section key={key}><h4>{label}</h4>{signals.length ? signals.map(signal=><div className="learnedTasteSignal" key={signal.value}><div><strong>{signal.value}</strong><small>{signal.sampleCount} signal{signal.sampleCount===1?"":"s"} · {Math.round(signal.confidence*100)}% confidence · {signal.sources.join(" + ")}</small></div><meter min={0} max={1} value={signal.confidence} aria-label={`Confidence for ${signal.value}`}/></div>) : <p className="agentMuted">Not enough evidence yet</p>}</section>;
    })}</div>
    <small className="agentMuted">Only observed metadata is used. Skips are a weak signal; they never automatically block an artist or genre.</small>
  </section>;
}
