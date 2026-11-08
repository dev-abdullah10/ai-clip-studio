import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastViewport } from "./components/ToastViewport";
import { ClipEditor } from "./pages/ClipEditor";
import { Dashboard } from "./pages/Dashboard";
import { Exports } from "./pages/Exports";
import { Import } from "./pages/Import";
import { Jobs } from "./pages/Jobs";
import { NotFound } from "./pages/NotFound";
import { ProjectDetail } from "./pages/ProjectDetail";
import { Projects } from "./pages/Projects";
import { Settings } from "./pages/Settings";

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="projects" element={<Projects />} />
            <Route path="projects/:id" element={<ProjectDetail />} />
            <Route path="clips/:id" element={<ClipEditor />} />
            <Route path="import" element={<Import />} />
            <Route path="jobs" element={<Jobs />} />
            <Route path="exports" element={<Exports />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <ToastViewport />
    </ErrorBoundary>
  );
}
