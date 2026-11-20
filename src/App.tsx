import { Route, Routes } from "react-router-dom";
import AppShell from "@/components/AppShell";
import Analytics from "@/pages/Analytics";
import CaseStub from "@/pages/CaseStub";
import Settings from "@/pages/Settings";
import Worklist from "@/pages/Worklist";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Worklist />} />
        <Route path="/case/:id" element={<CaseStub />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
