import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

import { getConnection } from '@/modules/database/connection.js';
import type { QueuedTurnAttempt, QueuedTurnRecord } from '@/shared/types.js';

/** Database migrations installs the durable queue and append-only attempt receipts. */
export function initializeMessageQueueTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_queue (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL, session_id TEXT NOT NULL, request_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL, content TEXT NOT NULL, options TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', revision INTEGER NOT NULL DEFAULT 0,
      attempt_count INTEGER NOT NULL DEFAULT 0, run_id TEXT, error TEXT,
      created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
      UNIQUE(user_id,request_id)
    );
    CREATE INDEX IF NOT EXISTS idx_message_queue_session ON message_queue(session_id,sequence,status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_message_queue_running ON message_queue(session_id) WHERE status='running';
    CREATE TABLE IF NOT EXISTS message_queue_attempts (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL, attempt INTEGER NOT NULL,
      status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_queue_attempts_message ON message_queue_attempts(message_id,attempt);
  `);
}

/** Queue service and dispatcher use atomic claims and revision-checked updates through this repository. */
export const messageQueueDb = {
  importLegacy(candidate: {userId:number;sessionId:string;claimToken:string}, create: () => QueuedTurnRecord): boolean {
    const db=getConnection();
    return db.transaction(() => {
      const current=db.prepare('SELECT queued_message FROM session_drafts WHERE user_id=? AND draft_scope=?')
        .get(candidate.userId,candidate.sessionId) as {queued_message:string|null}|undefined;
      if (current?.queued_message!==candidate.claimToken) return false;
      create();
      db.prepare('UPDATE session_drafts SET queued_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND draft_scope=? AND queued_message=?')
        .run(candidate.userId,candidate.sessionId,candidate.claimToken);
      return true;
    })();
  },
  get(userId: number, id: string): QueuedTurnRecord|undefined {
    return getConnection().prepare('SELECT * FROM message_queue WHERE user_id=? AND id=?').get(userId,id) as QueuedTurnRecord|undefined;
  },
  byRequest(userId: number, requestId: string): QueuedTurnRecord|undefined {
    return getConnection().prepare('SELECT * FROM message_queue WHERE user_id=? AND request_id=?').get(userId,requestId) as QueuedTurnRecord|undefined;
  },
  list(userId: number, sessionId: string): QueuedTurnRecord[] {
    // Pending work is never truncated by the bounded history view.
    return getConnection().prepare(`SELECT * FROM message_queue WHERE user_id=? AND session_id=?
      AND (status IN ('queued','running','failed','interrupted') OR id IN (
        SELECT id FROM message_queue WHERE user_id=? AND session_id=? ORDER BY sequence DESC LIMIT 50))
      ORDER BY sequence`).all(userId,sessionId,userId,sessionId) as QueuedTurnRecord[];
  },
  create(userId: number, sessionId: string, requestId: string, payloadHash: string, content: string, options: string): QueuedTurnRecord {
    const id=randomUUID();
    getConnection().prepare(`INSERT INTO message_queue(id,user_id,session_id,request_id,payload_hash,content,options,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(id,userId,sessionId,requestId,payloadHash,content,options,new Date().toISOString());
    return this.get(userId,id)!;
  },
  heads(): QueuedTurnRecord[] {
    return getConnection().prepare(`SELECT q.* FROM message_queue q WHERE q.status='queued'
      AND NOT EXISTS(SELECT 1 FROM message_queue previous WHERE previous.session_id=q.session_id
        AND previous.sequence<q.sequence AND previous.status IN ('queued','running','failed','interrupted'))
      ORDER BY q.sequence LIMIT 8`).all() as QueuedTurnRecord[];
  },
  claim(id: string): QueuedTurnRecord|null {
    const db=getConnection();
    return db.transaction(() => {
      const runId=randomUUID(), now=new Date().toISOString();
      const changed=db.prepare(`UPDATE message_queue SET status='running',run_id=?,attempt_count=attempt_count+1,
        started_at=?,finished_at=NULL,error=NULL,revision=revision+1 WHERE id=? AND status='queued'
        AND NOT EXISTS(SELECT 1 FROM message_queue p WHERE p.session_id=message_queue.session_id
          AND p.sequence<message_queue.sequence AND p.status IN ('queued','running','failed','interrupted'))`)
        .run(runId,now,id);
      if (!changed.changes) return null;
      const row=db.prepare('SELECT * FROM message_queue WHERE id=?').get(id) as QueuedTurnRecord;
      db.prepare(`INSERT INTO message_queue_attempts(id,message_id,attempt,status,started_at)
        VALUES(?,?,?,'running',?)`).run(runId,id,row.attempt_count,now);
      return row;
    })();
  },
  defer(row: QueuedTurnRecord): void {
    const db=getConnection();
    db.transaction(() => {
      // No provider started: release the reservation, rather than fabricating a failed attempt.
      db.prepare("DELETE FROM message_queue_attempts WHERE id=? AND status='running'").run(row.run_id);
      db.prepare(`UPDATE message_queue SET status='queued',run_id=NULL,started_at=NULL,
        attempt_count=MAX(0,attempt_count-1),revision=revision+1 WHERE id=? AND run_id=? AND status='running'`)
        .run(row.id,row.run_id);
    })();
  },
  finish(row: QueuedTurnRecord, status: 'succeeded'|'failed'|'interrupted', error: string|null): void {
    const db=getConnection(), now=new Date().toISOString();
    db.transaction(() => {
      const changed=db.prepare(`UPDATE message_queue SET status=?,error=?,finished_at=?,revision=revision+1
        WHERE id=? AND run_id=? AND status='running'`).run(status,error,now,row.id,row.run_id);
      if (!changed.changes) return;
      db.prepare("UPDATE message_queue_attempts SET status=?,error=?,finished_at=? WHERE id=? AND status='running'")
        .run(status,error,now,row.run_id);
    })();
  },
  edit(userId: number, id: string, revision: number, content: string): boolean {
    return getConnection().prepare(`UPDATE message_queue SET content=?,revision=revision+1
      WHERE user_id=? AND id=? AND revision=? AND status='queued'`).run(content,userId,id,revision).changes>0;
  },
  action(userId: number, id: string, revision: number, action: 'retry'|'cancel'): boolean {
    return getConnection().prepare(`UPDATE message_queue SET status=?,revision=revision+1,
      run_id=NULL,error=CASE WHEN ?='retry' THEN NULL ELSE error END
      WHERE user_id=? AND id=? AND revision=? AND status IN (${action==='retry' ? "'failed','interrupted'" : "'queued','failed','interrupted'"})`)
      .run(action==='retry'?'queued':'cancelled',action,userId,id,revision).changes>0;
  },
  attempts(userId: number, id: string): QueuedTurnAttempt[] {
    return getConnection().prepare(`SELECT a.* FROM message_queue_attempts a JOIN message_queue q ON q.id=a.message_id
      WHERE q.user_id=? AND q.id=? ORDER BY a.attempt`).all(userId,id) as QueuedTurnAttempt[];
  },
  recover(): void {
    const db=getConnection(), now=new Date().toISOString();
    db.transaction(() => {
      const error='Server restarted before completion was confirmed. Review this attempt before retrying.';
      db.prepare("UPDATE message_queue_attempts SET status='interrupted',finished_at=?,error=? WHERE status='running'").run(now,error);
      db.prepare("UPDATE message_queue SET status='interrupted',finished_at=?,error=?,revision=revision+1 WHERE status='running'").run(now,error);
    })();
  },
};
