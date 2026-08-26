// AIGC START
'use client';

import { createContext, useContext } from 'react';

type WorkflowDagContextValue = {
  openPanel: () => void;
};

const WorkflowDagContext = createContext<WorkflowDagContextValue>({
  openPanel: () => {},
});

export function WorkflowDagProvider({
  openPanel,
  children,
}: {
  openPanel: () => void;
  children: React.ReactNode;
}) {
  return (
    <WorkflowDagContext.Provider value={{ openPanel }}>{children}</WorkflowDagContext.Provider>
  );
}

export function useWorkflowDagPanel() {
  return useContext(WorkflowDagContext);
}
// AIGC END
