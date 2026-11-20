import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "@/components/AppShell";
import Operations from "@/pages/Operations";
import Impact from "@/pages/Impact";
import CaseView from "@/pages/CaseView";
import Settings from "@/pages/Settings";
import EvaluationTrace from "@/pages/rules/EvaluationTrace";
import Worklist from "@/pages/Worklist";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Worklist />} />
        <Route path="/case/:id" element={<CaseView />} />
        <Route path="/analytics" element={<Operations />} />
        <Route path="/impact" element={<Impact />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/rules/*" element={<Navigate to="/settings" replace />} />
        <Route path="/evaluations/:id" element={<EvaluationTrace />} />
      </Route>
    </Routes>
  );
}
