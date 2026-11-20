import { Route, Routes } from "react-router-dom";
import AppShell from "@/components/AppShell";
import Analytics from "@/pages/Analytics";
import CaseStub from "@/pages/CaseStub";
import Settings from "@/pages/Settings";
import Compare from "@/pages/rules/Compare";
import DraftEditor from "@/pages/rules/DraftEditor";
import EvaluationTrace from "@/pages/rules/EvaluationTrace";
import PolicyDetail from "@/pages/rules/PolicyDetail";
import RulesList from "@/pages/rules/RulesList";
import Worklist from "@/pages/Worklist";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Worklist />} />
        <Route path="/case/:id" element={<CaseStub />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/rules" element={<RulesList />} />
        <Route path="/settings/rules/:policyId" element={<PolicyDetail />} />
        <Route path="/settings/rules/:policyId/versions/:versionId" element={<PolicyDetail />} />
        <Route path="/settings/rules/:policyId/versions/:versionId/edit" element={<DraftEditor />} />
        <Route path="/settings/rules/:policyId/compare" element={<Compare />} />
        <Route path="/evaluations/:id" element={<EvaluationTrace />} />
      </Route>
    </Routes>
  );
}
