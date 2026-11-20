import { Route, Routes } from "react-router-dom";
import Worklist from "@/pages/Worklist";
import CaseStub from "@/pages/CaseStub";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Worklist />} />
      <Route path="/case/:id" element={<CaseStub />} />
    </Routes>
  );
}
