// TASK ALLOCATION MODULE — its own tiny context, separate from AuthContext/
// StationContext. Checks the backend's TASK_ALLOCATION_ENABLED flag once
// (GET /api/task-allocation/enabled, no auth required) so the Sidebar and
// routes can hide the whole module when it's off, with no effect on any
// existing context or provider.
import { createContext, useContext, useEffect, useState } from "react";
import { getEnabled } from "../api/taskAllocation.js";

const TaskAllocationContext = createContext({ enabled: false, loading: true });

export function TaskAllocationProvider({ children }) {
  const [state, setState] = useState({ enabled: false, loading: true });

  useEffect(() => {
    let cancelled = false;
    getEnabled()
      .then(d => { if (!cancelled) setState({ enabled: !!d?.enabled, loading: false }); })
      .catch(() => { if (!cancelled) setState({ enabled: false, loading: false }); });
    return () => { cancelled = true; };
  }, []);

  return <TaskAllocationContext.Provider value={state}>{children}</TaskAllocationContext.Provider>;
}

export function useTaskAllocationEnabled() {
  return useContext(TaskAllocationContext);
}
