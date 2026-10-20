import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Loader2, MessageSquarePlus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ChatInterface } from '@/modules/chat';
import { api } from '@/shared/api';
import type { Project, ProjectSession, SessionNavigationOptions } from '@/shared/types';

// Reopening a panel while the fork request is in flight must reuse that request.
const pendingForks = new Map<string, Promise<ProjectSession>>();
const storageKey = (parentId: string) => `cloudcli-side-chat:${parentId}`;

async function resolveSideChat(parent: ProjectSession): Promise<ProjectSession> {
  const existing = pendingForks.get(parent.id);
  if (existing) return existing;
  const pending = (async () => {
    const saved = localStorage.getItem(storageKey(parent.id));
    if (saved) {
      const response = await api.sessionDetails(saved);
      if (response.ok) return { id: saved, __provider: 'claude', summary: 'Side chat' } as ProjectSession;
      if (response.status !== 404) throw new Error(`HTTP ${response.status}`);
      localStorage.removeItem(storageKey(parent.id));
    }
    const response = await api.forkSession(parent.id, { title: `↳ ${parent.summary || parent.name || 'Side chat'}`.slice(0, 120) });
    const payload = await response.json();
    const id = payload?.data?.sessionId;
    if (!response.ok || typeof id !== 'string') {
      throw new Error(payload?.error?.message || payload?.message || `HTTP ${response.status}`);
    }
    localStorage.setItem(storageKey(parent.id), id);
    return { id, __provider: 'claude', summary: payload.data.sessionName || 'Side chat' } as ProjectSession;
  })();
  pendingForks.set(parent.id, pending);
  try { return await pending; } finally { pendingForks.delete(parent.id); }
}

type SideChatPanelProps = {
  parent: ProjectSession;
  project: Project;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  draft?: { id: number; text: string };
  onClose: () => void;
  onPromote: (id: string, options?: SessionNavigationOptions) => void;
  onReturnReply: (text: string) => void;
  onShowSettings: () => void;
  showThinking: boolean;
  showRawParameters: boolean;
  sendByCtrlEnter: boolean;
};

/** WorkspaceMain uses this independently keyed panel to discuss a snapshot of its parent chat. */
export function SideChatPanel({ parent, project, ws, sendMessage, draft, onClose, onPromote,
  onReturnReply, onShowSettings, showThinking, showRawParameters, sendByCtrlEnter }: SideChatPanelProps) {
  const { t } = useTranslation('chat');
  // The fork ID is distinct from the main session and persists across panel closure.
  const [session, setSession] = useState<ProjectSession | null>(null);
  // Failed requests stay visible, with an explicit retry that cannot duplicate a pending fork.
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let active = true;
    setError('');
    void resolveSideChat(parent).then(value => {
      if (active) setSession(value);
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [parent.id, attempt]);

  useEffect(() => { panelRef.current?.focus(); }, []);
  return <aside ref={panelRef} tabIndex={-1} aria-label={t('sideChat.title')}
    data-claude-side-pane data-side-chat
    className="side-chat-panel flex h-full min-h-0 min-w-0 flex-col outline-none"
    onKeyDown={event => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.stopPropagation(); onClose();
      }
    }}>
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
      <MessageSquarePlus size={16} className="text-muted-foreground" />
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{t('sideChat.title')}</h2>
      {session && <button type="button" className="workspace-icon-button" title={t('sideChat.openFull')}
        aria-label={t('sideChat.openFull')} onClick={() => onPromote(session.id)}><ArrowUpRight size={16}/></button>}
      <button type="button" className="workspace-icon-button" aria-label={t('sideChat.close')}
        onClick={onClose}><X size={16}/></button>
    </header>
    <p className="border-b border-border/60 px-4 py-2 text-xs leading-relaxed text-muted-foreground">{t('sideChat.context')}</p>
    {error ? <div role="alert" className="m-4 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm">
      <p>{t('sideChat.failed')}</p><p className="mt-2 break-words text-xs text-muted-foreground">{error}</p>
      <button className="mt-3 rounded-lg border px-3 py-1.5" onClick={() => setAttempt(value => value + 1)}>{t('sideChat.retry')}</button>
    </div> : !session ? <div role="status" className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 size={16} className="animate-spin"/>{t('sideChat.loading')}
    </div> : <div className="min-h-0 flex-1">
      <ChatInterface isSideChat isActive selectedProject={project} selectedSession={session}
        ws={ws} sendMessage={sendMessage} onShowSettings={onShowSettings}
        onNavigateToSession={onPromote} draftInsertion={draft} onReturnReply={onReturnReply}
        showThinking={showThinking} showRawParameters={showRawParameters} sendByCtrlEnter={sendByCtrlEnter}/>
    </div>}
  </aside>;
}
