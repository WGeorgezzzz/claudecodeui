import { monitorsDb, sessionsDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

/** Used by monitor HTTP routes for validation and lifecycle changes. */
export const monitorsService = {
  create(userId: number, input: Record<string, unknown>) {
    const sessionId=typeof input.sessionId==='string'?input.sessionId:'';
    const content=typeof input.content==='string'?input.content.trim():'';
    const name=typeof input.name==='string'?input.name.trim():'';
    const intervalMinutes=input.intervalMinutes;
    if (!name || name.length>120 || !content || content.length>20_000 ||
      typeof intervalMinutes!=='number' || !Number.isInteger(intervalMinutes) || intervalMinutes<1 || intervalMinutes>10_080) {
      throw new AppError('请填写名称、检查内容和 1–10080 分钟的整数间隔。',{code:'INVALID_MONITOR',statusCode:400});
    }
    const session=sessionsDb.getSessionById(sessionId);
    if (!session || session.provider!=='claude' || session.isArchived) {
      throw new AppError('请选择一个未归档的 Claude 会话。',{code:'INVALID_MONITOR_SESSION',statusCode:400});
    }
    const options=input.options && typeof input.options==='object' && !Array.isArray(input.options)
      ? input.options as Record<string,unknown> : {};
    // Only composer choices are persisted; callers cannot override cwd/session or inject runtime control options.
    const safeOptions: Record<string,unknown>={};
    for(const key of ['model','effort']) if(typeof options[key]==='string') safeOptions[key]=options[key];
    if(['default','acceptEdits','plan','bypassPermissions'].includes(String(options.permissionMode))) safeOptions.permissionMode=options.permissionMode;
    safeOptions.permissionMode ??= 'default';
    return monitorsDb.create({userId,sessionId,name,content,intervalMinutes,options:safeOptions});
  },
  list(userId: number,sessionId?: string) {return monitorsDb.list(userId,sessionId);},
  update(userId: number,id: string,input: {name?:string;content?:string;intervalMinutes?:number}) {
    const row=this.require(userId,id);
    if(row.status==='stopped')throw new AppError('已停止的监测不能修改。',{code:'MONITOR_CONFLICT',statusCode:409});
    const name=(input.name??row.name).trim();
    const content=(input.content??row.content).trim();
    const intervalMinutes=input.intervalMinutes??row.interval_minutes;
    if(!name||name.length>120||!content||content.length>20000||!Number.isInteger(intervalMinutes)||intervalMinutes<1||intervalMinutes>10080)
      throw new AppError('名称、内容或间隔无效。',{code:'INVALID_MONITOR',statusCode:400});
    monitorsDb.update(userId,id,{name,content,intervalMinutes});
    return this.require(userId,id);
  },
  history(userId: number,id: string) {this.require(userId,id);return monitorsDb.history(userId,id);},
  require(userId: number,id: string) {
    const row=monitorsDb.get(userId,id);
    if(!row) throw new AppError('监测任务不存在。',{code:'MONITOR_NOT_FOUND',statusCode:404});
    return row;
  },
  action(userId: number,id: string,action: unknown) {
    const row=this.require(userId,id);
    if(action!=='pause' && action!=='resume' && action!=='stop' && action!=='run-now')
      throw new AppError('无效操作。',{code:'INVALID_MONITOR_ACTION',statusCode:400});
    if(row.status==='stopped' || (action==='run-now' && (row.status!=='active'||row.running_id)))
      throw new AppError('该任务当前不能执行此操作。',{code:'MONITOR_CONFLICT',statusCode:409});
    monitorsDb.action(userId,id,action);
    return monitorsDb.get(userId,id);
  },
};
