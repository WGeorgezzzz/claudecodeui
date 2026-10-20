import assert from 'node:assert/strict';

import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { test, vi } from 'vitest';

import '@/modules/i18n';
import GitDiffViewer from '@/modules/git-panel/GitDiffViewer';

const { insert } = vi.hoisted(() => ({insert:vi.fn()}));
vi.mock('@/modules/command-palette',()=>({usePaletteOps:()=>({insertComposerText:insert})}));
vi.mock('@/shared/hooks/useSelectedProvider',()=>({useSelectedProvider:()=> 'claude'}));
const diff='@@ -10,2 +10,2 @@\n-old value\n+new value\n unchanged';

test('line feedback preserves the file, side and real line number and only fills the draft',()=>{
  const view=render(<GitDiffViewer diff={diff} filePath="src/a.ts" isMobile={false} wrapText={false}/>);
  fireEvent.click(view.getByRole('button',{name:'Comment on src/a.ts line 10 (original)'}));
  fireEvent.change(view.getByRole('textbox',{name:'Review comment'}),{target:{value:'Keep this check'}});
  fireEvent.click(view.getByRole('button',{name:'Add to Claude draft'}));
  assert.match(insert.mock.calls.at(-1)?.[0],/src\/a.ts:10 \(original side/);
  assert.match(insert.mock.calls.at(-1)?.[0],/Code: old value\nKeep this check/);
});

test('an external diff change keeps the comment text and prevents stale feedback',()=>{
  const view=render(<GitDiffViewer diff={diff} filePath="src/a.ts" isMobile={false} wrapText={false}/>);
  fireEvent.click(view.getByRole('button',{name:'Comment on src/a.ts line 10 (updated)'}));
  fireEvent.change(view.getByRole('textbox',{name:'Review comment'}),{target:{value:'Check this'}});
  view.rerender(<GitDiffViewer diff={diff+'\n+another'} filePath="src/a.ts" isMobile={false} wrapText={false}/>);
  assert.equal((view.getByRole('button',{name:'Add to Claude draft'}) as HTMLButtonElement).disabled,true);
  assert.equal((view.getByRole('textbox',{name:'Review comment'}) as HTMLTextAreaElement).value,'Check this');
});
