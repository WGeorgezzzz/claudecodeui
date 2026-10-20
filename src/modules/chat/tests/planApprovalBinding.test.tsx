import assert from 'node:assert/strict';

import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { test, vi } from 'vitest';

import '@/modules/i18n';
import PermissionContext from '@/modules/chat/context/PermissionContext';
import { PlanDisplay } from '@/modules/chat/tools/PlanDisplay';

test('only the current plan can be approved, and approval leaves Plan mode',()=>{
  const decision=vi.fn(), approved=vi.fn();
  const value={pendingPermissionRequests:[{requestId:'request-new',toolName:'ExitPlanMode',toolId:'tool-new'}],handlePermissionDecision:decision,onPlanApproved:approved};
  const view=render(<PermissionContext.Provider value={value}><PlanDisplay title="Old plan" content="Old" toolName="ExitPlanMode" toolId="tool-old"/></PermissionContext.Provider>);
  assert.equal(view.queryByRole('button',{name:/Approve plan/}),null);
  view.rerender(<PermissionContext.Provider value={value}><PlanDisplay title="New plan" content="New" toolName="ExitPlanMode" toolId="tool-new"/></PermissionContext.Provider>);
  fireEvent.click(view.getByRole('button',{name:/Approve plan/}));
  assert.equal(approved.mock.calls.length,1);
  assert.deepEqual(decision.mock.calls[0],['request-new',{allow:true}]);
});
