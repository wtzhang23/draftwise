import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Activity, BarChart3, BrainCircuit, Check, ChevronDown, CircleHelp, Database,
  Download, GripVertical, Info, Minus, Plus, RotateCcw, Search, Settings,
  ShieldCheck, SlidersHorizontal, Sparkles, Target, Trash2, TrendingUp, Undo2,
  Upload, UserRoundCheck, Users, X, Zap,
} from 'lucide-react';
import { players as demoPlayers, dataUpdatedAt } from './data/players';
import { providers } from './data/providers';
import { DEFAULT_SETTINGS, defaultManagerNames, rosterCounts, teamAtPick } from './lib/draft';
import { fuzzyPlayers } from './lib/fuzzy';
import { recommendations } from './lib/optimizer';
import { exportState, importState, loadState, saveState } from './lib/storage';
import { loadDownloadedPlayerData } from './lib/playerData';
import { importSleeperDraftPicks, importSleeperLeague } from './lib/sleeper';
import type { DraftPick, DraftState, LeagueSettings, Player, PlayerDataMetadata, Position, RosterSettings } from './types';

const POSITIONS: Array<Position | 'ALL'> = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'];
const POSITION_COLOR: Record<Position, string> = {
  QB: '#a78bfa', RB: '#48d6a8', WR: '#68a9ff', TE: '#f5a95e', K: '#f472b6', DST: '#94a3b8',
};
const DEMO_PICK_IDS = [
  'ja-marr-chase-cin', 'bijan-robinson-atl', 'jahmyr-gibbs-det',
  'justin-jefferson-min', 'ceedee-lamb-dal', 'puka-nacua-lar',
];
const SLEEPER_SYNC_INTERVAL_MS = 10_000;

function initialState(): DraftState {
  const saved = loadState();
  if (saved) return {
    ...saved,
    connections: saved.connections ?? { sleeperDraftId: '', autoSyncSleeper: false },
    settings: {
      ...saved.settings,
      managerNames: saved.settings.managerNames ?? defaultManagerNames(saved.settings.teams),
    },
  };
  return {
    settings: DEFAULT_SETTINGS,
    picks: DEMO_PICK_IDS.map((playerId, index) => ({
      id: `demo-${index}`, playerId, teamIndex: teamAtPick(index + 1, DEFAULT_SETTINGS.teams, DEFAULT_SETTINGS.format), overall: index + 1,
    })),
    userTeamIndex: DEFAULT_SETTINGS.draftSlot - 1,
    riskTolerance: 48,
    scarcityWeight: 55,
    activePosition: 'ALL',
    connections: { sleeperDraftId: '', autoSyncSleeper: false },
  };
}

function positionStyle(position: Position) {
  return { '--position': POSITION_COLOR[position] } as CSSProperties;
}

function PlayerAvatar({ player, large = false }: { player: Player; large?: boolean }) {
  const initials = player.position === 'DST'
    ? player.team
    : player.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('');
  return <div className={`avatar ${large ? 'avatar-large' : ''}`} style={positionStyle(player.position)}>{initials}</div>;
}

function Metric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'good' | 'warn' }) {
  return <div className="metric"><span>{label}</span><strong className={tone}>{value}</strong></div>;
}

function App() {
  const [state, setState] = useState<DraftState>(initialState);
  const [playerPool, setPlayerPool] = useState<Player[]>(demoPlayers);
  const [playerMetadata, setPlayerMetadata] = useState<PlayerDataMetadata | null>(null);
  const [playerDataStatus, setPlayerDataStatus] = useState<'loading' | 'downloaded' | 'demo' | 'error'>('loading');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const [toast, setToast] = useState('');
  const [entryTeamIndex, setEntryTeamIndex] = useState(0);
  const [unknownPosition, setUnknownPosition] = useState<Position>('WR');
  const [lastRecorded, setLastRecorded] = useState<{ playerId: string; teamIndex: number; previousTopId?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const syncingSleeper = useRef(false);

  useEffect(() => saveState(state), [state]);
  useEffect(() => {
    const controller = new AbortController();
    loadDownloadedPlayerData(controller.signal).then(({ players, metadata }) => {
      setPlayerPool(players);
      setPlayerMetadata(metadata);
      setPlayerDataStatus('downloaded');
      setState((previous) => {
        const byName = new Map(players.map((player) => [player.name.toLowerCase().replace(/[^a-z0-9]/g, ''), player.id]));
        const remappedPicks = previous.picks.map((pick) => {
          const oldPlayer = demoPlayers.find((player) => player.id === pick.playerId);
          if (!oldPlayer) return pick;
          const replacementId = byName.get(oldPlayer.name.toLowerCase().replace(/[^a-z0-9]/g, ''));
          return replacementId ? { ...pick, playerId: replacementId } : pick;
        });
        return { ...previous, picks: remappedPicks };
      });
    }).catch((error) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setPlayerDataStatus('error');
    });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const ranked = useMemo(() => recommendations(state, playerPool), [state, playerPool]);
  const top = ranked[0];
  const draftedIds = useMemo(() => new Set(state.picks.map((pick) => pick.playerId)), [state.picks]);
  const available = useMemo(() => playerPool.filter((player) => !draftedIds.has(player.id)), [draftedIds, playerPool]);
  const matches = useMemo(() => fuzzyPlayers(query, available), [query, available]);
  const currentOverall = state.picks.length + 1;
  const currentTeam = teamAtPick(currentOverall, state.settings.teams, state.settings.format);
  const round = Math.floor((currentOverall - 1) / state.settings.teams) + 1;
  const pickInRound = (currentOverall - 1) % state.settings.teams + 1;
  const isUserTurn = currentTeam === state.userTeamIndex;
  const ownCounts = rosterCounts(state.picks, state.userTeamIndex, playerPool);
  const ownPicks = state.picks.filter((pick) => pick.teamIndex === state.userTeamIndex)
    .map((pick) => playerPool.find((player) => player.id === pick.playerId)).filter(Boolean) as Player[];

  useEffect(() => setEntryTeamIndex(currentTeam), [currentTeam]);

  const teamLabel = (teamIndex: number) => {
    const manager = state.settings.managerNames?.[teamIndex]?.trim() || `Manager ${teamIndex + 1}`;
    return teamIndex === state.userTeamIndex ? `${manager} (You)` : `${manager} · Team ${teamIndex + 1}`;
  };
  const lastPlayer = lastRecorded ? playerPool.find((player) => player.id === lastRecorded.playerId) : undefined;
  const previousTop = lastRecorded?.previousTopId ? playerPool.find((player) => player.id === lastRecorded.previousTopId) : undefined;

  const syncSleeper = useCallback(async (announce = true) => {
    if (!state.connections.sleeperDraftId || syncingSleeper.current) return;
    syncingSleeper.current = true;
    try {
      const result = await importSleeperDraftPicks(state.connections.sleeperDraftId, playerPool);
      setState((previous) => ({
        ...previous,
        picks: result.picks,
        connections: { ...previous.connections, lastSleeperSync: new Date().toISOString() },
      }));
      if (announce) setToast(result.unmatched.length
        ? `Synced ${result.picks.length} picks; ${result.unmatched.length} player${result.unmatched.length === 1 ? '' : 's'} could not be matched`
        : `Synced ${result.picks.length} Sleeper picks`);
    } catch (error) {
      if (announce) setToast(error instanceof Error ? error.message : 'Sleeper sync failed');
    } finally {
      syncingSleeper.current = false;
    }
  }, [playerPool, state.connections.sleeperDraftId]);

  useEffect(() => {
    if (!state.connections.autoSyncSleeper || !state.connections.sleeperDraftId) return;
    void syncSleeper(false);
    const interval = window.setInterval(() => void syncSleeper(false), SLEEPER_SYNC_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [state.connections.autoSyncSleeper, state.connections.sleeperDraftId, syncSleeper]);

  const addPick = (player: Player, teamIndex = entryTeamIndex) => {
    const pick: DraftPick = {
      id: `${Date.now()}-${player.id}`, playerId: player.id, overall: currentOverall, teamIndex,
    };
    setLastRecorded({ playerId: player.id, teamIndex, previousTopId: ranked[0]?.player.id });
    setState((previous) => ({ ...previous, picks: [...previous.picks, pick] }));
    setQuery('');
    setSearchOpen(false);
    setToast(`${teamLabel(teamIndex)} drafted ${player.name}`);
  };

  const recordUnlistedPick = () => {
    const displayName = query.trim();
    if (!displayName) return;
    const pick: DraftPick = {
      id: `${Date.now()}-unlisted`,
      playerId: `unlisted-${Date.now()}`,
      displayName,
      position: unknownPosition,
      teamIndex: entryTeamIndex,
      overall: currentOverall,
    };
    setState((previous) => ({ ...previous, picks: [...previous.picks, pick] }));
    setLastRecorded(null);
    setQuery('');
    setSearchOpen(false);
    setToast(`Recorded unlisted ${unknownPosition} ${displayName} for ${teamLabel(entryTeamIndex)}`);
  };

  const updatePickTeam = (pickId: string, teamIndex: number) => {
    setState((previous) => ({
      ...previous,
      picks: previous.picks.map((pick) => pick.id === pickId ? { ...pick, teamIndex } : pick),
    }));
    setToast(`Pick reassigned to ${teamLabel(teamIndex)}; recommendations updated`);
  };

  const renameManager = (teamIndex: number, name: string) => {
    setState((previous) => {
      const managerNames = [...previous.settings.managerNames];
      managerNames[teamIndex] = name;
      return { ...previous, settings: { ...previous.settings, managerNames } };
    });
  };

  const undo = () => {
    if (!state.picks.length) return;
    const player = playerPool.find((candidate) => candidate.id === state.picks.at(-1)?.playerId);
    setState((previous) => ({ ...previous, picks: previous.picks.slice(0, -1) }));
    setLastRecorded(null);
    setToast(player ? `Removed ${player.name}` : 'Last pick removed');
  };

  const reset = () => {
    setState((previous) => ({ ...previous, picks: [], activePosition: 'ALL' }));
    setLastRecorded(null);
    setToast('Draft board cleared');
  };

  const handleImport = async (file?: File) => {
    if (!file) return;
    try {
      setState(await importState(file));
      setToast('Draft imported');
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not import draft');
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><BarChart3 size={21} /></div><span>Draft<span>Wise</span></span></div>
        <div className="league-chip"><span className="live-dot" /> <strong>{state.settings.name}</strong><span>{state.settings.teams} teams · {state.settings.scoringLabel}</span><ChevronDown size={14} /></div>
        <div className="header-actions">
          <button className="source-status" onClick={() => setSourcesOpen(true)}><Database size={15} /><span>{playerDataStatus === 'downloaded' ? 'Local real data' : playerDataStatus === 'loading' ? 'Loading data…' : 'Demo fallback'}</span><em>{playerDataStatus === 'downloaded' ? `${playerPool.length} players` : 'check setup'}</em></button>
          <button className="icon-button" aria-label="Help"><CircleHelp size={19} /></button>
          <button className="button secondary small" onClick={() => setSettingsOpen(true)}><Settings size={16} /> League setup</button>
        </div>
      </header>

      <main className="workspace">
        <aside className="left-rail">
          <section className={`clock-card ${isUserTurn ? 'your-turn' : ''}`}>
            <div className="eyebrow"><span className="pulse-ring" /> {teamLabel(currentTeam)} — on the clock</div>
            <div className="pick-number"><strong>{round}.{String(pickInRound).padStart(2, '0')}</strong><span>Pick {currentOverall} overall</span></div>
            <div className="clock"><span>01</span><i>:</i><span>42</span></div>
            <div className="next-turn"><Target size={15} /> Your slot: {state.settings.draftSlot}</div>
          </section>

          <section className="rail-section">
            <div className="section-title"><span>My roster</span><em>{ownPicks.length}/{Object.values(state.settings.roster).reduce((a, b) => a + b, 0)}</em></div>
            <div className="roster-list">
              {(['QB', 'RB', 'WR', 'TE', 'FLEX'] as const).map((slot) => {
                const slotPlayer = slot === 'FLEX' ? undefined : ownPicks.find((player) => player.position === slot);
                return <div className={`roster-row ${slotPlayer ? 'filled' : ''}`} key={slot}>
                  <span className="slot">{slot}</span>
                  {slotPlayer ? <><PlayerAvatar player={slotPlayer} /><div><strong>{slotPlayer.name}</strong><small>{slotPlayer.team} · Bye {slotPlayer.bye}</small></div></> : <div className="empty-slot">Open starting slot</div>}
                </div>;
              })}
            </div>
            <button className="text-button"><Users size={15} /> View full roster <span>→</span></button>
          </section>

          <section className="rail-section sliders">
            <div className="section-title"><span>Model controls</span><SlidersHorizontal size={15} /></div>
            <label><span>Risk appetite <b>{state.riskTolerance}</b></span><input type="range" min="0" max="100" value={state.riskTolerance} onChange={(event) => setState({ ...state, riskTolerance: Number(event.target.value) })} /></label>
            <label><span>Scarcity pressure <b>{state.scarcityWeight}</b></span><input type="range" min="0" max="100" value={state.scarcityWeight} onChange={(event) => setState({ ...state, scarcityWeight: Number(event.target.value) })} /></label>
            <small>Recommendations update instantly. Every adjustment is visible in the score breakdown.</small>
          </section>
        </aside>

        <section className="main-column">
          <div className="recommendation-heading">
            <div><div className="eyebrow accent"><Sparkles size={14} /> Decision engine</div><h1>Best pick right now</h1><p>Optimized for your roster, this room, and who may not make it back.</p></div>
            <div className="confidence"><span>Model confidence</span><strong>{top?.confidence ?? 0}%</strong><div><i style={{ width: `${top?.confidence ?? 0}%` }} /></div></div>
          </div>

          {lastRecorded && lastPlayer && <div className="impact-banner">
            <div className="impact-icon"><TrendingUp size={17} /></div>
            <div><strong>Board recalculated after {teamLabel(lastRecorded.teamIndex)} took {lastPlayer.name}</strong><span>{previousTop?.id === lastPlayer.id ? `${top?.player.name ?? 'The next player'} moves into the top recommendation.` : `${top?.player.name ?? 'The top recommendation'} remains the best risk-adjusted decision.`} Opponent needs and position availability have been refreshed.</span></div>
            <button onClick={() => setLastRecorded(null)} aria-label="Dismiss update"><X size={15} /></button>
          </div>}

          {top && <article className="hero-card">
            <div className="hero-glow" />
            <div className="rank-badge">#1</div>
            <div className="hero-player"><PlayerAvatar player={top.player} large /><div><span className="position-tag" style={positionStyle(top.player.position)}>{top.player.position}</span><h2>{top.player.name}</h2><p>{top.player.team} · Bye {top.player.bye} · Tier {top.player.tier}</p></div></div>
            <div className="hero-score"><span>DraftWise score</span><strong>{Math.round(top.score)}</strong><em>+{Math.max(1, Math.round(top.score - (ranked[1]?.score ?? top.score - 1)))} vs next best</em></div>
            <div className="reason-grid">
              {top.reasons.map((reason, index) => <div key={reason}><span className={`reason-icon r${index}`}><Check size={14} /></span><p>{reason}</p></div>)}
            </div>
            <div className="metric-grid">
              <Metric label="Projected" value={`${Math.round(top.player.projectedPoints)} pts`} tone="good" />
              <Metric label="Gone by next turn" value={`${Math.round(top.availabilityRisk)}%`} tone={top.availabilityRisk > 50 ? 'warn' : 'default'} />
              <Metric label="Active-game probability" value={`${Math.round(top.player.context.gameAvailability)}%`} />
              <Metric label="Coach usage" value={`${top.player.context.coachUsage}/100`} />
            </div>
            <div className="hero-actions">{isUserTurn
              ? <button className="button primary" onClick={() => addPick(top.player, state.userTeamIndex)}><Zap size={17} /> Draft {top.player.name.split(' ')[0]} for my team</button>
              : <button className="button primary peer-prompt" onClick={() => { setEntryTeamIndex(currentTeam); setSearchOpen(true); searchInputRef.current?.focus(); }}><Users size={17} /> Enter {teamLabel(currentTeam)}'s pick <span>→</span></button>}
              <button className="button ghost" onClick={() => setSelected(0)}><BrainCircuit size={17} /> Explain score</button></div>
          </article>}

          <div className="alternatives-head"><div><h3>Next best options</h3><span>Click a player to inspect the full model</span></div><div className="position-tabs">{POSITIONS.map((position) => <button className={state.activePosition === position ? 'active' : ''} onClick={() => setState({ ...state, activePosition: position })} key={position}>{position}</button>)}</div></div>
          <div className="player-table">
            <div className="table-head"><span>Player</span><span>Projection</span><span>Availability</span><span>Fit</span><span>Score</span><span /></div>
            {ranked.slice(1, 7).map((recommendation, index) => <div className={`table-row ${selected === index + 1 ? 'selected' : ''}`} key={recommendation.player.id} onClick={() => setSelected(index + 1)}>
              <div className="player-cell"><b>{index + 2}</b><PlayerAvatar player={recommendation.player} /><div><strong>{recommendation.player.name}</strong><small><span style={{ color: POSITION_COLOR[recommendation.player.position] }}>{recommendation.player.position}</span> · {recommendation.player.team} · Tier {recommendation.player.tier}</small></div></div>
              <div><strong>{Math.round(recommendation.player.projectedPoints)}</strong><small>floor {Math.round(recommendation.player.floor)}</small></div>
              <div><strong>{Math.round(recommendation.availabilityRisk)}%</strong><small>gone next turn</small></div>
              <div className="fit-bars"><i /><i /><i className={recommendation.rosterFit > 0 ? 'on' : ''} /></div>
              <div className="score-pill">{Math.round(recommendation.score)}</div>
              <button className="draft-mini" onClick={(event) => { event.stopPropagation(); addPick(recommendation.player, isUserTurn ? state.userTeamIndex : currentTeam); }}>{isUserTurn ? 'Draft' : 'Record'}</button>
            </div>)}
          </div>

          {ranked[selected] && <section className="model-strip">
            <div className="strip-title"><Activity size={17} /><div><strong>Why {ranked[selected].player.name} ranks here</strong><span>Context signals are modestly weighted to avoid double-counting provider projections.</span></div></div>
            <div className="strip-metrics">
              <Metric label="Offense" value={`${ranked[selected].player.context.offenseQuality > 0 ? '+' : ''}${ranked[selected].player.context.offenseQuality}`} tone={ranked[selected].player.context.offenseQuality > 3 ? 'good' : 'default'} />
              <Metric label="Opportunity" value={`${ranked[selected].player.context.opportunity}/100`} />
              <Metric label="Depth chart" value={`${ranked[selected].player.context.depthChartSecurity}/100`} />
              <Metric label="Context adj." value={`${ranked[selected].contextAdjustment >= 0 ? '+' : ''}${ranked[selected].contextAdjustment.toFixed(1)}`} />
              <Metric label="Injury risk" value={`${ranked[selected].player.injuryRisk}%`} tone={ranked[selected].player.injuryRisk > 20 ? 'warn' : 'default'} />
            </div>
          </section>}
        </section>

        <aside className="right-rail">
          <div className="search-section">
            <div className="entry-kicker"><span className="pulse-ring" /> Live draft entry · Pick {currentOverall}</div>
            <h2>Who did they draft?</h2>
            <p className="entry-help">Choose the team on the clock, then select the player they just picked. Your recommendations recalculate immediately.</p>
            <label className="team-picker">
              <span>Picking team</span>
              <div><Users size={16} /><select value={entryTeamIndex} onChange={(event) => setEntryTeamIndex(Number(event.target.value))}>
                {Array.from({ length: state.settings.teams }, (_, index) => <option value={index} key={index}>{teamLabel(index)}{index === currentTeam ? ' · on the clock' : ''}</option>)}
              </select><ChevronDown size={15} /></div>
            </label>
            <label className="manager-picker"><span>Person picking</span><div><Users size={16} /><input value={state.settings.managerNames[entryTeamIndex] ?? ''} placeholder={`Manager ${entryTeamIndex + 1}`} onChange={(event) => renameManager(entryTeamIndex, event.target.value)} /><em>Team {entryTeamIndex + 1}</em></div></label>
            <label className="player-picker"><span>Player selected</span>
              <div className="search-box"><Search size={17} /><input ref={searchInputRef} value={query} placeholder={`Search the player ${teamLabel(entryTeamIndex)} drafted`} onFocus={() => setSearchOpen(true)} onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }} /><kbd>⌘ K</kbd></div>
            </label>
            {searchOpen && <div className="autocomplete">
              <div className="auto-label"><span>{query ? `Best matches for “${query}”` : 'Top available'}</span><em>Recording for {teamLabel(entryTeamIndex)}</em></div>
              {matches.map((player) => <button key={player.id} onClick={() => addPick(player)}><PlayerAvatar player={player} /><span><strong>{player.name}</strong><small>{player.position} · {player.team}</small></span><em>ADP {player.adp}</em></button>)}
              {!matches.length && <div className="unlisted-player">
                <div><strong>No close match found</strong><span>Keep the draft moving by recording the name and position. No performance estimate will be invented.</span></div>
                <label><span>Position</span><select value={unknownPosition} onChange={(event) => setUnknownPosition(event.target.value as Position)}>{(['QB', 'RB', 'WR', 'TE', 'K', 'DST'] as Position[]).map((position) => <option key={position}>{position}</option>)}</select></label>
                <button className="button secondary" disabled={!query.trim()} onClick={recordUnlistedPick}>Record “{query.trim() || 'unlisted player'}”</button>
              </div>}
            </div>}
          </div>

          <div className="activity-head"><div className="section-title"><span>Recorded picks</span><span className="live-label">LIVE</span></div><button onClick={undo} disabled={!state.picks.length}><Undo2 size={15} /> Undo last</button></div>
          <div className="activity-list">
            {state.picks.slice(-10).reverse().map((pick) => {
              const player = playerPool.find((candidate) => candidate.id === pick.playerId);
              const pickRound = Math.floor((pick.overall - 1) / state.settings.teams) + 1;
              const pickSlot = (pick.overall - 1) % state.settings.teams + 1;
              const position = player?.position ?? pick.position;
              return <div className={pick.teamIndex === state.userTeamIndex ? 'mine' : ''} key={pick.id}><span className="pick-index">{pickRound}.{String(pickSlot).padStart(2, '0')}</span>{player ? <PlayerAvatar player={player} /> : <div className="avatar unknown-avatar" style={position ? positionStyle(position) : undefined}>?</div>}<div className="activity-player"><strong>{player?.name ?? pick.displayName ?? 'Unlisted player'}</strong><small>{position ?? 'Position unknown'} · {player?.team ?? pick.team ?? 'No analytics row'}</small></div><label className="activity-team"><span className="sr-only">Change drafting team</span><select value={pick.teamIndex} onChange={(event) => updatePickTeam(pick.id, Number(event.target.value))}>{Array.from({ length: state.settings.teams }, (_, index) => <option value={index} key={index}>{teamLabel(index)}</option>)}</select></label></div>;
            })}
          </div>
          <div className="rail-footer">
            <button onClick={() => exportState(state)}><Download size={15} /> Export</button>
            <button onClick={() => fileRef.current?.click()}><Upload size={15} /> Import</button>
            <button onClick={reset}><RotateCcw size={15} /> Reset</button>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={(event) => handleImport(event.target.files?.[0])} />
          </div>
        </aside>
      </main>

      {settingsOpen && <SettingsModal state={state} onClose={() => setSettingsOpen(false)} onSave={(settings, userTeamIndex, oldToNewTeamIndex) => {
        setState((previous) => ({
          ...previous,
          settings: { ...settings, draftSlot: userTeamIndex + 1 },
          userTeamIndex,
          picks: previous.picks.map((pick) => ({
            ...pick,
            teamIndex: oldToNewTeamIndex[pick.teamIndex] ?? Math.min(pick.teamIndex, settings.teams - 1),
          })),
        }));
        setSettingsOpen(false);
        setToast('League size and draft order saved');
      }} />}
      {sourcesOpen && <SourcesModal
        onClose={() => setSourcesOpen(false)}
        status={playerDataStatus}
        metadata={playerMetadata}
        sleeperDraftId={state.connections.sleeperDraftId}
        autoSyncSleeper={state.connections.autoSyncSleeper}
        lastSleeperSync={state.connections.lastSleeperSync}
        onConnectionChange={(connection) => setState((previous) => ({
          ...previous, connections: { ...previous.connections, ...connection },
        }))}
        onSync={() => void syncSleeper(true)}
      />}
      {toast && <div className="toast"><Check size={16} /> {toast}</div>}
    </div>
  );
}

interface ConfigTeam {
  id: string;
  name: string;
  originalIndex?: number;
}

const MIN_LEAGUE_TEAMS = 2;
const MAX_LEAGUE_TEAMS = 32;

function SettingsModal({ state, onClose, onSave }: {
  state: DraftState;
  onClose: () => void;
  onSave: (settings: LeagueSettings, userTeamIndex: number, oldToNewTeamIndex: Record<number, number>) => void;
}) {
  const [settings, setSettings] = useState(structuredClone(state.settings));
  const [teams, setTeams] = useState<ConfigTeam[]>(() => Array.from({ length: state.settings.teams }, (_, index) => ({
    id: `original-${index}`,
    name: state.settings.managerNames[index] ?? `Manager ${index + 1}`,
    originalIndex: index,
  })));
  const [userTeamId, setUserTeamId] = useState(`original-${state.userTeamIndex}`);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [leagueId, setLeagueId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const newTeamSequence = useRef(0);
  const teamIndex = Math.max(0, teams.findIndex((team) => team.id === userTeamId));
  const rosterSize = Object.values(settings.roster).reduce((total, slots) => total + slots, 0);
  const totalDraftSelections = teams.length * rosterSize;
  const setRoster = (key: keyof RosterSettings, value: number) => setSettings({ ...settings, roster: { ...settings.roster, [key]: value } });
  const updateTeamName = (id: string, name: string) => setTeams((current) => current.map((team) => team.id === id ? { ...team, name } : team));
  const moveTeam = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= teams.length || to >= teams.length) return;
    setTeams((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };
  const addTeam = () => {
    if (teams.length >= MAX_LEAGUE_TEAMS) return;
    newTeamSequence.current += 1;
    setTeams((current) => [...current, {
      id: `new-${Date.now()}-${newTeamSequence.current}`,
      name: `Manager ${current.length + 1}`,
    }]);
  };
  const removeTeam = (team: ConfigTeam) => {
    if (teams.length <= MIN_LEAGUE_TEAMS) return;
    const next = teams.filter((candidate) => candidate.id !== team.id);
    setTeams(next);
    if (userTeamId === team.id) setUserTeamId(next[0].id);
  };
  const hasRecordedPicks = (team: ConfigTeam) => team.originalIndex !== undefined
    && state.picks.some((pick) => pick.teamIndex === team.originalIndex);
  const importSleeper = async () => {
    setLoading(true); setError('');
    try {
      const imported = await importSleeperLeague(leagueId);
      setSettings(imported);
      const importedTeams = Array.from({ length: imported.teams }, (_, index) => ({
        id: index < state.settings.teams ? `original-${index}` : `imported-${index}`,
        name: imported.managerNames[index] ?? `Manager ${index + 1}`,
        originalIndex: index < state.settings.teams ? index : undefined,
      }));
      setTeams(importedTeams);
      if (!importedTeams.some((team) => team.id === userTeamId)) setUserTeamId(importedTeams[0]?.id ?? '');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Import failed'); } finally { setLoading(false); }
  };
  const saveLeague = () => {
    const managerNames = teams.map((team, index) => team.name.trim() || `Manager ${index + 1}`);
    const oldToNewTeamIndex = Object.fromEntries(teams.flatMap((team, index) =>
      team.originalIndex === undefined ? [] : [[team.originalIndex, index]]));
    onSave({ ...settings, teams: teams.length, managerNames }, teamIndex, oldToNewTeamIndex);
  };
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal settings-modal" onMouseDown={(event) => event.stopPropagation()}>
    <div className="modal-head"><div><div className="eyebrow accent"><Settings size={14} /> League configuration</div><h2>Set up your draft room</h2><p>Add exactly the people in your league, drag them into draft order, then mark your team.</p></div><button className="icon-button" onClick={onClose}><X size={20} /></button></div>
    <div className="sleeper-import"><div><strong>Import from Sleeper</strong><span>League members, roster slots and scoring</span></div><input placeholder="Sleeper league ID" value={leagueId} onChange={(event) => setLeagueId(event.target.value)} /><button className="button secondary" disabled={!leagueId || loading} onClick={importSleeper}>{loading ? 'Importing…' : 'Import league'}</button>{error && <small>{error}</small>}</div>
    <div className="league-size-summary"><div><Users size={18} /><span>League size<strong>{teams.length} managers</strong></span></div><div><Target size={18} /><span>Roster size<strong>{rosterSize} per team</strong></span></div><div><BarChart3 size={18} /><span>Total draft picks<strong>{totalDraftSelections}</strong></span></div></div>
    <div className="form-grid">
      <label className="wide"><span>League name</span><input value={settings.name} onChange={(event) => setSettings({ ...settings, name: event.target.value })} /></label>
      <label><span>Draft format</span><select value={settings.format} onChange={(event) => setSettings({ ...settings, format: event.target.value as LeagueSettings['format'] })}><option value="snake">Snake</option><option value="linear">Linear</option><option value="third-round-reversal">Third-round reversal</option><option value="auction">Auction</option></select></label>
      <label><span>Reception points</span><select value={settings.scoring.reception} onChange={(event) => setSettings({ ...settings, scoringLabel: Number(event.target.value) === 1 ? 'Full PPR' : Number(event.target.value) === 0.5 ? 'Half PPR' : 'Standard', scoring: { ...settings.scoring, reception: Number(event.target.value) } })}><option value="1">1.0 · Full PPR</option><option value="0.5">0.5 · Half PPR</option><option value="0">0 · Standard</option></select></label>
      <label><span>Passing TD</span><input type="number" value={settings.scoring.passingTd} onChange={(event) => setSettings({ ...settings, scoring: { ...settings.scoring, passingTd: Number(event.target.value) } })} /></label>
    </div>
    <div className="manager-config"><div><div><strong>People and draft order</strong><span>Drag the grip to reorder. Pick 1 is first in the opening round.</span></div><button className="button secondary add-team" disabled={teams.length >= MAX_LEAGUE_TEAMS} onClick={addTeam}><Plus size={14} /> Add person</button></div><div className="team-order-list">{teams.map((team, index) => {
      const isUser = team.id === userTeamId;
      const cannotRemove = teams.length <= MIN_LEAGUE_TEAMS || hasRecordedPicks(team);
      return <div className={`team-order-card ${isUser ? 'is-user' : ''} ${draggingIndex === index ? 'dragging' : ''}`} key={team.id}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); if (draggingIndex !== null) moveTeam(draggingIndex, index); setDraggingIndex(null); }}>
        <button className="drag-handle" draggable aria-label={`Drag ${team.name || `Manager ${index + 1}`}`} onDragStart={() => setDraggingIndex(index)} onDragEnd={() => setDraggingIndex(null)}><GripVertical size={17} /></button>
        <span className="draft-slot">{index + 1}</span>
        <label><span>Manager or team name</span><input value={team.name} placeholder={`Manager ${index + 1}`} onChange={(event) => updateTeamName(team.id, event.target.value)} /></label>
        <button className={`you-button ${isUser ? 'active' : ''}`} onClick={() => setUserTeamId(team.id)}><UserRoundCheck size={14} /> {isUser ? 'You' : 'Set as you'}</button>
        <button className="remove-team" disabled={cannotRemove} title={hasRecordedPicks(team) ? 'This team has recorded picks' : 'Remove person'} onClick={() => removeTeam(team)}><Trash2 size={14} /></button>
      </div>;
    })}</div><small className="team-order-note">Reordering also reassigns any recorded picks to the same manager. Teams with recorded picks cannot be removed.</small></div>
    <div className="roster-config"><div><strong>Roster slots</strong><span>{rosterSize} players per manager · {totalDraftSelections} total selections</span></div><div>{(Object.keys(settings.roster) as Array<keyof RosterSettings>).map((key) => <label key={key}><span>{key}</span><div className="slot-stepper"><button onClick={() => setRoster(key, Math.max(0, settings.roster[key] - 1))}><Minus size={13} /></button><input type="number" min="0" max="24" value={settings.roster[key]} onChange={(event) => setRoster(key, Math.max(0, Number(event.target.value)))} /><button onClick={() => setRoster(key, Math.min(24, settings.roster[key] + 1))}><Plus size={13} /></button></div></label>)}</div></div>
    <div className="modal-actions"><button className="button ghost" onClick={onClose}>Cancel</button><button className="button primary" onClick={saveLeague}>Save league and order</button></div>
  </div></div>;
}

function SourcesModal({
  onClose, status, metadata, sleeperDraftId, autoSyncSleeper, lastSleeperSync, onConnectionChange, onSync,
}: {
  onClose: () => void;
  status: 'loading' | 'downloaded' | 'demo' | 'error';
  metadata: PlayerDataMetadata | null;
  sleeperDraftId: string;
  autoSyncSleeper: boolean;
  lastSleeperSync?: string;
  onConnectionChange: (connection: Partial<DraftState['connections']>) => void;
  onSync: () => void;
}) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal sources-modal" onMouseDown={(event) => event.stopPropagation()}>
    <div className="modal-head"><div><div className="eyebrow accent"><Database size={14} /> Data connections</div><h2>Real data, with visible limits</h2><p>The app prefers its downloaded player pool and falls back to clearly labeled demo data if that file is unavailable.</p></div><button className="icon-button" onClick={onClose}><X size={20} /></button></div>
    <div className={`source-callout ${status === 'downloaded' ? 'connected' : ''}`}><ShieldCheck size={21} /><div><strong>{status === 'downloaded' ? 'Downloaded dataset is active' : status === 'loading' ? 'Loading downloaded dataset…' : 'Synthetic fallback is active'}</strong><span>{metadata?.description ?? 'Run npm run data:download to refresh rankings, rosters and the prior-season statistical baseline.'}</span></div></div>
    <div className="connection-panel">
      <div><strong>Sleeper live draft</strong><span>Paste the draft ID—not the league ID—to import every room pick and team slot.</span></div>
      <label><span>Draft ID</span><input value={sleeperDraftId} placeholder="e.g. 1234567890123456789" onChange={(event) => onConnectionChange({ sleeperDraftId: event.target.value })} /></label>
      <div className="connection-actions"><button className="button secondary" disabled={!sleeperDraftId} onClick={onSync}>Sync picks now</button><label className="toggle"><input type="checkbox" checked={autoSyncSleeper} disabled={!sleeperDraftId} onChange={(event) => onConnectionChange({ autoSyncSleeper: event.target.checked })} /><span>Auto-sync every 10 seconds</span></label></div>
      {lastSleeperSync && <small>Last successful sync: {new Date(lastSleeperSync).toLocaleTimeString()}</small>}
    </div>
    <div className="source-callout"><Info size={21} /><div><strong>Current injury limitation</strong><span>Open nflverse injury reports are not reliable as a current 2026 feed. The baseline uses prior games missed as a conservative risk prior; current medical status still needs a licensed feed or manual review.</span></div></div>
    <div className="sources-list">{providers.map((provider) => <a href={provider.url} target="_blank" rel="noreferrer" key={provider.id}><div className={`provider-icon ${provider.kind}`}><Database size={18} /></div><div><strong>{provider.name}</strong><span>{provider.description}</span><small>{provider.kind} · {provider.status.replace('-', ' ')}</small></div><span className="external">↗</span></a>)}</div>
    <div className="model-factors"><div><Info size={18} /><strong>Expected-value inputs</strong></div><p>Scoring-adjusted projections · value over replacement · positional scarcity · opponent roster demand · next-turn survival · active-game probability · coach usage · depth-chart security · offensive environment · line quality · role/team-change impact · schedule · market disagreement · injury and model uncertainty.</p></div>
    <div className="data-date"><span>{metadata ? `Generated ${new Date(metadata.generatedAt).toLocaleString()} · ${metadata.playerCount} players` : dataUpdatedAt}</span><span>Not medical advice · Provider terms apply</span></div>
  </div></div>;
}

export default App;
