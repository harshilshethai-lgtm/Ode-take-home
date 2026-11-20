import { useState } from "react";
import { Check, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { Button } from "@/components/ui/button";
import { TextArea, TextInput } from "@/components/ui/form";
import { DEMO_NOW } from "@/data/orders";
import { composeFax, type OutreachBrief } from "@/domain/outreach";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";

export interface OutreachSent {
  at: string;
  partyName: string;
  labels: string[];
}

const storageKey = (orderId: string) => `halcyon.outreach.${orderId}`;

function readSent(orderId: string): OutreachSent | null {
  try {
    const raw = localStorage.getItem(storageKey(orderId));
    return raw ? (JSON.parse(raw) as OutreachSent) : null;
  } catch {
    return null;
  }
}

export function useOutreachSent(orderId: string) {
  const [forId, setForId] = useState(orderId);
  const [sent, setSent] = useState<OutreachSent | null>(() => readSent(orderId));
  if (forId !== orderId) {
    setForId(orderId);
    setSent(readSent(orderId));
  }
  const save = (value: OutreachSent) => {
    localStorage.setItem(storageKey(orderId), JSON.stringify(value));
    setSent(value);
  };
  return [sent, save] as const;
}

function viewDetail() {
  const el = document.querySelector('[data-review="To resolve"]') ?? document.querySelector('[data-review="Checklist"]') ?? document.querySelector('[data-review="Checks"]');
  el?.scrollIntoView({ block: "start" });
}

export function FaxOutreach({
  brief,
  sent,
  senderName,
  onSent,
}: {
  brief: OutreachBrief;
  sent: OutreachSent | null;
  senderName: string;
  onSent: (value: OutreachSent) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(() => brief.items.map((item) => item.id));
  const [otherOn, setOtherOn] = useState(false);
  const [other, setOther] = useState("");
  const [fax, setFax] = useState(brief.fax);
  const [forId, setForId] = useState(brief.orderId);

  if (forId !== brief.orderId) {
    setForId(brief.orderId);
    setSelected(brief.items.map((item) => item.id));
    setOtherOn(false);
    setOther("");
    setFax(brief.fax);
    setOpen(false);
  }

  const openComposer = () => {
    setSelected(brief.items.map((item) => item.id));
    setOtherOn(false);
    setOther("");
    setFax(brief.fax);
    setOpen(true);
  };

  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((item) => item !== id) : [...cur, id]));
  const letter = composeFax(brief, selected, otherOn ? other : "", senderName, fmtDate(DEMO_NOW), sent !== null);
  letter.fax = fax.trim();
  const ready = letter.asks.length > 0 && fax.trim().length >= 7;

  const send = () => {
    if (!ready) return;
    const labels = brief.items.filter((item) => selected.includes(item.id)).map((item) => item.label);
    if (otherOn && other.trim()) labels.push(other.trim());
    onSent({ at: DEMO_NOW.toISOString(), partyName: brief.partyName, labels });
    setOpen(false);
  };

  const sentLine = sent ? `Fax sent to ${sent.partyName} for ${sent.labels.join(", ")}.` : brief.banner;

  return (
    <>
      <section data-outreach className="flex items-stretch overflow-hidden rounded-lg border border-line bg-result-warning-bg">
        <span className="w-1 shrink-0 bg-warning" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-48 flex-1">
            <div className="text-caption text-fg-2">To do</div>
            <div className="text-body text-fg">{sentLine}</div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button variant="ghost" onClick={viewDetail}>
              View detail
            </Button>
            <Button variant={sent ? "secondary" : "default"} onClick={openComposer}>
              {sent ? "Send again" : "Fax outreach"}
            </Button>
          </div>
        </div>
      </section>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
          <Dialog.Content
            aria-describedby={undefined}
            className="animate-collapsible fixed bottom-8 left-1/2 top-24 z-50 flex w-full max-w-3xl -translate-x-1/2 flex-col rounded-lg border border-line bg-panel text-body text-fg shadow-sm"
          >
            <div className="flex h-12 shrink-0 items-center border-b border-line px-4">
              <Dialog.Title className="text-emph text-fg">Fax outreach</Dialog.Title>
              <Dialog.Close aria-label="Close" className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-fg-2 hover:bg-hover hover:text-fg">
                <X size={16} />
              </Dialog.Close>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-2">
              <div className="min-h-0 overflow-y-auto border-r border-line p-4">
                <div className="text-caption text-fg-2">What this auth still needs from them.</div>

                <div className="mt-4 text-caption text-fg-2">Sending to</div>
                <div className="mt-1 text-caption text-fg-2">{brief.partyRole}</div>
                <div className="text-emph text-fg">{brief.partyName}</div>
                <label className="mt-3 block text-caption text-fg-2" htmlFor="outreach-fax">
                  Fax number
                </label>
                <TextInput id="outreach-fax" value={fax} onChange={(e) => setFax(e.target.value)} placeholder="Fax number" className="mt-1 tabular" />
                <div className="mt-1 text-caption text-fg-2">{brief.partyNote}</div>

                <div className="mt-4 text-caption text-fg-2">Ask them for</div>
                <div className="mt-1">
                  {brief.items.map((item) => (
                    <CheckRow key={item.id} checked={selected.includes(item.id)} label={item.label} onChange={() => toggle(item.id)} />
                  ))}
                  <CheckRow checked={otherOn} label="Other" onChange={() => setOtherOn((on) => !on)} />
                  {otherOn && (
                    <TextArea
                      value={other}
                      onChange={(e) => setOther(e.target.value)}
                      placeholder="Add what else this packet needs"
                      aria-label="Other request"
                      className="mt-1"
                    />
                  )}
                </div>
              </div>

              <div className="min-h-0 overflow-y-auto bg-app p-4" aria-label="Fax preview">
                <article className="rounded-lg border border-line border-t-2 border-t-accent bg-panel p-4">
                  <div className="text-emph text-fg">Halcyon Health</div>
                  <div className="text-caption text-fg-2">Prior authorization</div>
                  <div className="mt-3 border-t border-line pt-3 text-caption text-fg-2">{letter.date}</div>
                  <div className="mt-3 text-body text-fg">
                    {letter.toRole}
                    <div>{letter.toName}</div>
                    <div className="tabular text-fg-2">{letter.fax || "Fax number needed"}</div>
                  </div>
                  <div className="mt-3 text-body text-fg">Re: {letter.regarding}</div>
                  {letter.paragraphs.map((paragraph) => (
                    <div key={paragraph} className="mt-3 text-body text-fg">
                      {paragraph}
                    </div>
                  ))}
                  {letter.asks.length > 0 && (
                    <ul className="mt-3 list-disc pl-4 text-body text-fg">
                      {letter.asks.map((ask) => (
                        <li key={ask}>{ask}</li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-4 text-body text-fg">
                    {letter.signoff.map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </div>
                </article>
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-4 py-3">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="default" disabled={!ready} onClick={send}>
                Send fax
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function CheckRow({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-md border",
          checked ? "border-accent bg-accent text-on-accent" : "border-line bg-panel",
        )}
      >
        {checked && <Check size={12} />}
      </button>
      <span className="text-body text-fg">{label}</span>
    </div>
  );
}
