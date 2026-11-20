import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { Field, SelectInput, TextInput } from "@/components/ui/form";
import { ApiError } from "@/data/rules/service";
import type { Policy } from "@/domain/rules/types";
import { BODY_SITE_OPTIONS } from "@/lib/ruleForm";
import { useRulesActor } from "@/lib/rulesActor";
import { useRules } from "@/lib/useRules";

const NEW_PAYER = "";
const OTHER_SITE = "other";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new policy and its empty draft, so the caller can open it in edit mode. */
  onCreated: (policy: Policy, draftId: string) => void;
}

export function NewPolicyDialog({ open, onOpenChange, onCreated }: Props) {
  const rules = useRules();
  const actor = useRulesActor();
  const payers = rules.listPayers();

  const [payerId, setPayerId] = useState(payers[0]?.id ?? NEW_PAYER);
  const [newPayerName, setNewPayerName] = useState("");
  const [externalPolicyId, setExternalPolicyId] = useState("");
  const [title, setTitle] = useState("");
  const [site, setSite] = useState(BODY_SITE_OPTIONS[0].id);
  const [otherSite, setOtherSite] = useState("");
  const [error, setError] = useState<string | null>(null);

  const creatingPayer = payerId === NEW_PAYER;
  const bodySite = site === OTHER_SITE ? otherSite : site;
  const ready = (creatingPayer ? newPayerName.trim() : payerId) && externalPolicyId.trim() && title.trim() && bodySite.trim();

  const create = () => {
    try {
      const { policy, draft } = rules.createPolicy(
        { payerId: creatingPayer ? undefined : payerId, newPayerName: creatingPayer ? newPayerName : undefined, externalPolicyId, title, bodySite },
        actor,
      );
      onOpenChange(false);
      onCreated(policy, draft.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create the policy.");
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="New policy"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="default" disabled={!ready} onClick={create}>
            Create policy
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Payer">
          {(id) => (
            <SelectInput id={id} value={payerId} onChange={(e) => setPayerId(e.target.value)}>
              {payers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value={NEW_PAYER}>New payer…</option>
            </SelectInput>
          )}
        </Field>
        {creatingPayer && (
          <Field label="Payer name">
            {(id) => <TextInput id={id} value={newPayerName} autoFocus onChange={(e) => setNewPayerName(e.target.value)} />}
          </Field>
        )}
        <Field label="Policy ID">
          {(id) => <TextInput id={id} value={externalPolicyId} placeholder="e.g. RAD-114" onChange={(e) => setExternalPolicyId(e.target.value)} />}
        </Field>
        <Field label="Title">
          {(id) => <TextInput id={id} value={title} placeholder="e.g. MRI of the lumbar spine" onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field label="Body site">
          {(id) => (
            <SelectInput id={id} value={site} onChange={(e) => setSite(e.target.value)}>
              {BODY_SITE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
              <option value={OTHER_SITE}>Other…</option>
            </SelectInput>
          )}
        </Field>
        {site === OTHER_SITE && (
          <Field label="Other body site">{(id) => <TextInput id={id} value={otherSite} onChange={(e) => setOtherSite(e.target.value)} />}</Field>
        )}
        {error && <span className="text-caption text-red-500">{error}</span>}
      </div>
    </Modal>
  );
}
