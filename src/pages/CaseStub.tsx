import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { PageTitle } from "@/components/ui/page-title";
import { SEED_ORDERS } from "@/data/orders";

/** Placeholder for the case view (parsed record left, source PDFs right). Built in a later stage. */
export default function CaseStub() {
  const { id } = useParams();
  const order = SEED_ORDERS.find((o) => o.id === id);

  return (
    <div className="mx-auto max-w-page p-6">
      <Link to="/" className="mb-4 inline-flex h-7 items-center gap-1 text-body text-accent-fg hover:underline">
        <ArrowLeft size={14} /> Worklist
      </Link>
      <PageTitle>{order?.patient?.name ?? "Case not found"}</PageTitle>
    </div>
  );
}
