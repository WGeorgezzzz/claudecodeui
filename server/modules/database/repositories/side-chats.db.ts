import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

import { getConnection } from '@/modules/database/connection.js';
import type { SideChatRecord } from '@/shared/types.js';

/** Database migrations installs side-chat metadata separately from provider transcripts. */
export function initializeSideChatTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS side_chats (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, parent_session_id TEXT NOT NULL,
      child_session_id TEXT NOT NULL UNIQUE, request_id TEXT NOT NULL, request_title TEXT NOT NULL, title TEXT NOT NULL,
      status TEXT NOT NULL, context_cutoff TEXT NOT NULL, context_frozen_at TEXT, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, error TEXT, UNIQUE(user_id,request_id)
    );
    CREATE INDEX IF NOT EXISTS idx_side_chats_parent ON side_chats(user_id,parent_session_id,created_at);
  `);
  const columns=db.prepare('PRAGMA table_info(side_chats)').all() as {name:string}[];
  if (!columns.some(column=>column.name==='request_title')) {
    db.exec("ALTER TABLE side_chats ADD COLUMN request_title TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE side_chats SET request_title=title WHERE request_title=''");
  }
  if (!columns.some(column=>column.name==='context_frozen_at')) {
    db.exec('ALTER TABLE side_chats ADD COLUMN context_frozen_at TEXT');
  }
}

/** Side-chats service uses these synchronous operations around the provider's asynchronous fork. */
export const sideChatsDb = {
  isManagedSideSession(sessionId: string): boolean {
    return Boolean(getConnection().prepare("SELECT 1 FROM side_chats WHERE child_session_id=? AND status<>'promoted'").get(sessionId));
  },
  get(userId: number, id: string): SideChatRecord|undefined {
    return getConnection().prepare('SELECT * FROM side_chats WHERE user_id=? AND id=?').get(userId,id) as SideChatRecord|undefined;
  },
  byRequest(userId: number, requestId: string): SideChatRecord|undefined {
    return getConnection().prepare('SELECT * FROM side_chats WHERE user_id=? AND request_id=?').get(userId,requestId) as SideChatRecord|undefined;
  },
  list(userId: number, parentId: string): SideChatRecord[] {
    return getConnection().prepare('SELECT * FROM side_chats WHERE user_id=? AND parent_session_id=? ORDER BY created_at,id')
      .all(userId,parentId) as SideChatRecord[];
  },
  reserve(userId: number, parentId: string, requestId: string, title: string, childId: string = randomUUID(), contextCutoff?: string): SideChatRecord {
    const now=new Date().toISOString(), id=randomUUID();
    getConnection().prepare(`INSERT INTO side_chats
      (id,user_id,parent_session_id,child_session_id,request_id,request_title,title,status,context_cutoff,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'creating',?,?,?)`).run(id,userId,parentId,childId,requestId,title,title,contextCutoff??now,now,now);
    return this.get(userId,id)!;
  },
  update(userId: number, id: string, status: SideChatRecord['status'], title: string, error: string|null = null, contextFrozenAt?: string): SideChatRecord {
    getConnection().prepare('UPDATE side_chats SET status=?,title=?,error=?,updated_at=?,context_frozen_at=COALESCE(?,context_frozen_at) WHERE user_id=? AND id=?')
      .run(status,title,error,new Date().toISOString(),contextFrozenAt??null,userId,id);
    return this.get(userId,id)!;
  },
  recover(): void {
    // A fork may have committed its reserved child immediately before a crash.
    // Attach that child; never issue a second provider fork automatically.
    getConnection().prepare(`UPDATE side_chats SET
      status=CASE WHEN EXISTS(SELECT 1 FROM sessions WHERE session_id=side_chats.child_session_id
        AND forked_from_session_id=side_chats.parent_session_id) THEN 'active' ELSE 'failed' END,
      error=CASE WHEN EXISTS(SELECT 1 FROM sessions WHERE session_id=side_chats.child_session_id
        AND forked_from_session_id=side_chats.parent_session_id) THEN NULL ELSE 'Creation interrupted; create a new side conversation to retry.' END,
      updated_at=? WHERE status='creating'`).run(new Date().toISOString());
  },
};
