import assert from 'node:assert/strict';

import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { test, vi } from 'vitest';

import '@/modules/i18n';
import WorkspaceMain from '@/modules/project-workspace/WorkspaceMain';

const { shellProps } = vi.hoisted(()=>({shellProps:[] as Record<string,unknown>[]}));
vi.mock('@/modules/chat',()=>({ChatInterface:()=> <div>Chat content</div>}));
vi.mock('@/modules/git-panel',()=>({GitPanel:()=> <div>Changes content</div>}));
vi.mock('@/modules/file-tree',()=>({FileTree:()=> <div>Files content</div>}));
vi.mock('@/modules/plugins',()=>({PluginTabContent:()=>null}));
vi.mock('@/modules/browser-use',()=>({useBrowserUseEnabled:()=>false,BrowserUsePanel:()=>null}));
vi.mock('@/modules/task-master',()=>({useTasksSettings:()=>({tasksEnabled:false,isTaskMasterInstalled:false}),useTaskMasterProjectSync:()=>{},TaskMasterPanel:()=>null}));
vi.mock('@/modules/standalone-shell',()=>({StandaloneShell:(props:Record<string,unknown>)=>{shellProps.push(props);return <div>Terminal content</div>;}}));
vi.mock('@/modules/command-palette',()=>({usePaletteOpsRegister:()=>{}}));
vi.mock('@/shared/context/UiPreferencesContext',()=>({useUiPreferences:()=>({showThinking:true,showRawParameters:false,sendByCtrlEnter:false}),useSetUiPreference:()=>()=>{}}));
vi.mock('@/shared/hooks/useSelectedProvider',()=>({useSelectedProvider:()=> 'claude'}));
vi.mock('@/modules/project-workspace/WorkspaceHeader',()=>({default:()=>null}));
vi.mock('@/modules/project-workspace/hooks/useFileOpenResolver',()=>({useFileOpenResolver:()=>()=>{}}));
vi.mock('@/modules/code-editor',()=>({EditorSidebar:()=>null,useEditorSidebar:()=>({editingFile:null,editorExpanded:false,handleFileOpen:()=>true,handleCloseEditor:()=>{}})}));

const base: React.ComponentProps<typeof WorkspaceMain> = {
  selectedProject:{projectId:'p1',displayName:'Test',fullPath:'/test'},
  selectedSession:{id:'s1',__provider:'claude'},activeTab:'git',setActiveTab:()=>{},ws:null,sendMessage:()=>{},
  isMobile:false,onMenuClick:()=>{},isLoading:false,onNavigateToSession:()=>{},onSessionEstablished:()=>{},
  onShowSettings:()=>{},externalMessageUpdate:0,newSessionTrigger:0,onProjectSelect:()=>{},onProjectsRefresh:()=>{},onRenameSession:async()=>true,
};

test('Claude keeps chat visible alongside its changes pane',()=>{
  const view=render(<WorkspaceMain {...base}/>);
  assert.equal(view.getByTestId('workspace-chat-pane').classList.contains('hidden'),false);
  assert.ok(view.getByText('Changes content').closest('[data-claude-side-pane]'));
});

test('Claude terminal is plain, has no session to resume, and stays mounted on return to chat',()=>{
  const view=render(<WorkspaceMain {...base} activeTab="shell"/>);
  assert.equal(shellProps.at(-1)?.isPlainShell,true);
  assert.equal(shellProps.at(-1)?.session,null);
  view.rerender(<WorkspaceMain {...base} activeTab="chat"/>);
  assert.ok(view.getByText('Terminal content'));
  assert.equal(shellProps.at(-1)?.isActive,false);
});

test('other providers retain their full-page workspace',()=>{
  const view=render(<WorkspaceMain {...base} selectedSession={{id:'other',__provider:'codex'}}/>);
  assert.equal(view.getByTestId('workspace-chat-pane').classList.contains('hidden'),true);
  assert.equal(view.queryByTestId('claude-workspace-controls'),null);
});

test('tool pane width is keyboard adjustable, bounded, and survives reopening',()=>{
  localStorage.removeItem('claude-workspace-panel-percent');
  const view=render(<WorkspaceMain {...base}/>);
  const divider=view.getByRole('separator');
  fireEvent.keyDown(divider,{key:'ArrowLeft'});
  assert.equal(divider.getAttribute('aria-valuenow'),'55');
  fireEvent.keyDown(divider,{key:'End'});
  fireEvent.keyDown(divider,{key:'ArrowLeft'});
  assert.equal(divider.getAttribute('aria-valuenow'),'70');
  view.unmount();
  const reopened=render(<WorkspaceMain {...base}/>);
  assert.equal(reopened.getByRole('separator').getAttribute('aria-valuenow'),'70');
  fireEvent.doubleClick(reopened.getByRole('separator'));
  assert.equal(localStorage.getItem('claude-workspace-panel-percent'),'50');
});
