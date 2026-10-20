import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Repeat, X, Settings2 } from 'lucide-react';

import { api } from '@/shared/api';

type Task={id:string;session_id:string;name:string;content:string;interval_minutes:number;status:string;next_run_at:string;running_id:string|null;run_count:number;last_error:string|null;options:string};
type Run={id:string;started_at:string;status:string;error:string|null};
async function result(response:Response){const body=await response.json();if(!response.ok)throw Error(body?.error?.message||body?.message||body?.error||`HTTP ${response.status}`);return body.data;}

/** SidebarHeader presents all persisted monitors and their controls outside any one chat. */
export function MonitorDashboard(){
  // Keep the global task count visible even when the manager is closed.
  const [tasks,setTasks]=useState<Task[]>([]);
  // The manager is independent of chat navigation and leaves drafts untouched.
  const [open,setOpen]=useState(false);
  // Editable values are isolated from refreshed server snapshots until saved.
  const [edit,setEdit]=useState<{id:string;name:string;content:string;minutes:number}|null>(null);
  // Retain the requested task's latest receipts while its history is expanded.
  const [history,setHistory]=useState<{id:string;runs:Run[]}|null>(null);
  // Serialize user mutations and show any backend rejection in the manager.
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const load=async()=>setTasks(await result(await api.monitors.list()));
  useEffect(()=>{let live=true;const poll=()=>void api.monitors.list().then(result).then(data=>{if(live)setTasks(data);}).catch(e=>{if(live)setError(e.message);});poll();const timer=setInterval(poll,open?5000:15000);return()=>{live=false;clearInterval(timer);};},[open]);
  useEffect(()=>{if(!open)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[open]);
  const act=async(action:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await action();await load();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  const active=tasks.filter(t=>t.status==='active').length;
  const running=tasks.filter(t=>t.running_id).length;
  const button='rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-40';
  const statuses:Record<string,string>={active:'已启用',paused:'已暂停',stopped:'已停止',succeeded:'完成',failed:'失败',interrupted:'中断',running:'运行中'};
  return <>
    <button type="button" onClick={()=>setOpen(true)} aria-label={`自动监测，${active} 个已启用`} className="mt-2 flex w-full items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 text-left text-sm font-medium text-foreground hover:bg-primary/10">
      <Repeat className="h-4 w-4 text-primary"/><span>自动监测</span><span className="ml-auto rounded-full bg-primary/15 px-2 text-xs text-primary">{error?'连接异常':`${active} 个已启用`}</span>
    </button>
    {open&&createPortal(<div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4" onClick={e=>{if(e.target===e.currentTarget)setOpen(false);}}>
      <section role="dialog" aria-modal="true" aria-label="自动监测管理" className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border bg-background text-foreground shadow-xl">
        <header className="flex items-start justify-between border-b p-5"><div><h2 className="text-xl font-semibold">自动监测</h2><p className="mt-1 text-sm text-muted-foreground">{tasks.length} 个任务 · {active} 个已启用 · {running} 个运行中</p></div><button type="button" aria-label="关闭自动监测" onClick={()=>setOpen(false)}><X size={20}/></button></header>
        <div className="space-y-3 overflow-auto p-5">
          <p className="text-sm text-muted-foreground">在聊天中让 Claude 创建，或从聊天输入框旁的「监测」添加。这里统一管理全部会话的任务。</p>
          <div className="rounded-lg bg-muted p-3 text-sm">执行权限：<strong>Bypass · 全部允许</strong>。电脑和本地服务需运行；关闭聊天页面不影响监测。</div>
          {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
          {!tasks.length&&<p className="py-8 text-center text-muted-foreground">暂无自动监测。</p>}
          {[...tasks].sort((a,b)=>Number(a.status==='stopped')-Number(b.status==='stopped')).map(task=><article key={task.id} className="rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{task.name}</h3><span className="rounded-full bg-muted px-2 py-1 text-xs">{task.running_id?'运行中':statuses[task.status]}</span></div>
            <p className="mt-2 text-sm text-muted-foreground">每 {task.interval_minutes} 分钟 · 已执行 {task.run_count} 次{task.status==='active'&&!task.running_id?` · 下次 ${new Date(task.next_run_at).toLocaleString('zh-CN')}`:''}</p>
            {edit?.id===task.id?<form className="mt-3 space-y-2" onSubmit={e=>{e.preventDefault();void act(async()=>{await result(await api.monitors.update(task.id,{name:edit.name,content:edit.content,intervalMinutes:edit.minutes}));setEdit(null);});}}>
              <label className="block text-sm">名称<input aria-label="任务名称" required maxLength={120} value={edit.name} onChange={e=>setEdit({...edit,name:e.target.value})} className="mt-1 w-full rounded border bg-background p-2"/></label>
              <label className="block text-sm">检查内容<textarea aria-label="任务检查内容" required maxLength={20000} rows={5} value={edit.content} onChange={e=>setEdit({...edit,content:e.target.value})} className="mt-1 w-full rounded border bg-background p-2"/></label>
              <label className="block text-sm">间隔（分钟）<input aria-label="任务间隔分钟" type="number" required min={1} max={10080} value={edit.minutes} onChange={e=>setEdit({...edit,minutes:Number(e.target.value)})} className="ml-2 w-28 rounded border bg-background p-2"/></label>
              <p className="text-xs text-muted-foreground">修改作用于后续检查，不中断当前一轮。修改间隔会重新计算下次时间。</p>
              <button className={button} type="submit" disabled={busy}>保存调整</button> <button className={button} type="button" onClick={()=>setEdit(null)}>取消</button>
            </form>:<p className="my-3 max-h-28 overflow-auto whitespace-pre-wrap text-sm">{task.content}</p>}
            {task.last_error&&<p className="my-2 text-sm text-amber-600">{task.last_error}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {task.status!=='stopped'&&<button className={button} disabled={busy} onClick={()=>setEdit({id:task.id,name:task.name,content:task.content,minutes:task.interval_minutes})}><Settings2 size={13} className="mr-1 inline"/>调整</button>}
              {task.status==='active'&&<><button className={button} disabled={busy} onClick={()=>void act(()=>api.monitors.action(task.id,'pause').then(result))}>暂停</button><button className={button} disabled={busy||Boolean(task.running_id)} onClick={()=>void act(()=>api.monitors.action(task.id,'run-now').then(result))}>立即检查</button></>}
              {task.status==='paused'&&<button className={button} disabled={busy} onClick={()=>void act(()=>api.monitors.action(task.id,'resume').then(result))}>恢复</button>}
              {task.status!=='stopped'&&<button className={button} disabled={busy} onClick={()=>void act(()=>api.monitors.action(task.id,'stop').then(result))}>停止</button>}
              <button className={button} disabled={busy} onClick={()=>void act(async()=>setHistory({id:task.id,runs:await result(await api.monitors.runs(task.id))}))}>运行记录</button>
              <a href={`/session/${encodeURIComponent(task.session_id)}`} className={button}>打开会话</a>
            </div>
            {history?.id===task.id&&<ul className="mt-3 space-y-1 text-xs">{history.runs.length?history.runs.map(run=><li key={run.id}>{new Date(run.started_at).toLocaleString('zh-CN')} · {statuses[run.status]??run.status}{run.error?`：${run.error}`:''}</li>):<li>尚无运行记录</li>}</ul>}
          </article>)}
        </div>
        <footer className="border-t px-5 py-3 text-xs text-muted-foreground">暂停或停止不强制终止已经开始的一轮。每轮结束后等待设定间隔再检查；失败时暂停并保留记录。</footer>
      </section>
    </div>,document.body)}
  </>;
}
