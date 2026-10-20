import { createContext, useContext } from 'react';

import type { PendingPermissionRequest } from '@/shared/types';

export type PermissionContextValue = {
  /** Switches the local selector out of Plan after the user explicitly approves the plan. */
  onPlanApproved?: () => void;
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
};

const PermissionContext = createContext<PermissionContextValue | null>(null);

export function usePermission(): PermissionContextValue | null {
  return useContext(PermissionContext);
}

export default PermissionContext;
