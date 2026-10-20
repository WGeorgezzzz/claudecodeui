import { useCallback, useEffect, useRef, useState } from 'react';

import { api, readApiErrorMessage } from '@/shared/api';
import type { QueuedConversationMessage, QueuedMessageAttempt, QueueSubmission } from '@/shared/types';

async function readQueueResult<T>(response: Response): Promise<T> {
  const body=await response.json();
  if (!response.ok) throw new Error(readApiErrorMessage(body)||`HTTP ${response.status}`);
  return body.data as T;
}

/** ChatInterface uses durable server snapshots; transport retries reuse the same request ID. */
export function useMessageQueue(sessionId: string|null) {
  // A snapshot belongs only to the session that requested it.
  const [snapshot,setSnapshot]=useState<{sessionId:string|null;items:QueuedConversationMessage[]}>({sessionId,items:[]});
  // Transport errors remain visible while the composer's original input stays editable.
  const [error,setError]=useState('');
  const currentSession=useRef(sessionId);
  currentSession.current=sessionId;
  const requestSequence=useRef(0);
  const reload=useCallback(async()=>{
    if (!sessionId) return;
    const sequence=++requestSequence.current;
    const items=await readQueueResult<QueuedConversationMessage[]>(await api.messageQueue.list(sessionId));
    if (!Array.isArray(items)) throw new Error('Invalid message queue response.');
    if (currentSession.current===sessionId && sequence===requestSequence.current) setSnapshot({sessionId,items});
  },[sessionId]);
  useEffect(()=>{
    if (!sessionId) return;
    let active=true;
    const poll=()=>void reload().catch(reason=>{if(active)setError(String(reason.message));});
    poll();const timer=setInterval(poll,2000);
    return()=>{active=false;clearInterval(timer);requestSequence.current++;};
  },[sessionId,reload]);
  const enqueue=useCallback(async(submission:QueueSubmission, targetSessionId: string)=>{
    const options={...submission.options,attachments:submission.attachments};
    const fingerprint=JSON.stringify([targetSessionId,submission.content,options]);
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fingerprint))))
      .map(byte=>byte.toString(16).padStart(2,'0')).join('');
    const key=`cloudcli.queue-request:${targetSessionId}:${hash}`;
    const requestId=localStorage.getItem(key)||crypto.randomUUID();
    // Keep only the opaque ticket in browser storage. On an unknown outcome,
    // refreshing and retrying the same draft cannot create a duplicate turn.
    localStorage.setItem(key,requestId);
    try {
      await readQueueResult(await api.messageQueue.enqueue({sessionId:targetSessionId,requestId,content:submission.content,options}));
      localStorage.removeItem(key);
      setError('');
      // The POST acknowledgment is authoritative. A subsequent refresh failure
      // must not turn an accepted submission into a retry with a new ticket.
      if (currentSession.current===targetSessionId) void reload().catch(reason=>setError(String(reason.message)));
    } catch(reason) {
      setError(reason instanceof Error?reason.message:String(reason));
      throw reason;
    }
  },[reload]);
  const update=useCallback(async(item:QueuedConversationMessage,body:{content?:string;action?:'cancel'|'retry'})=>{
    try {
      await readQueueResult(await api.messageQueue.update(item.id,{revision:item.revision,...body}));
      setError('');await reload();
    } catch(reason) {setError(reason instanceof Error?reason.message:String(reason));throw reason;}
  },[reload]);
  const attempts=useCallback(async(id:string)=>
    readQueueResult<QueuedMessageAttempt[]>(await api.messageQueue.attempts(id)),[]);
  return {items:snapshot.sessionId===sessionId?snapshot.items:[],error,enqueue,update,attempts};
}
