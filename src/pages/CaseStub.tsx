import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { SEED_ORDERS } from "@/data/orders";

/** Placeholder for the case view (split view: parsed record left, raw PDF right). Built next. */
export default function CaseStub() {
  const { id } = useParams();
  const order = SEED_ORDERS.find((o) => o.id === id);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link to="/" className="mb-6 inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
        <ArrowLeft size={14} /> Back to worklist
      </Link>
      <h1 className="text-xl font-semibold">{order?.patient?.name ?? "Case not found"}</h1>
      <p className="mt-1 text-sm text-slate-500">Case view comes next: parsed record on the left, source PDFs on the right.</p>
    </div>
  );
}
