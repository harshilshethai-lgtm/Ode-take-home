import { useState } from "react";
import { Check, Copy, FileSearch, RefreshCw, Send, Shield, Stamp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { PropertyList } from "@/components/ui/property-list";
import type { InsurerPanelModel, InsurerTimelineRow } from "@/domain/insurer/view";

const ICONS = {
  eligibility: Shield,
  lookup: FileSearch,
  submission: Send,
  status: RefreshCw,
  appeal: Stamp,
} as const;

/** Full-width insurer history. Shown once the order has any insurer interaction. */
export function InsurerBlock({
  panel,
  onCheckNow,
  onFileAppeal,
  onCloseDenied,
  onPeer,
  onRecordOutcome,
  embedded = false,
}: {
  panel: InsurerPanelModel;
  onCheckNow?: () => void;
  onFileAppeal?: (letter: string) => void;
  onCloseDenied?: () => void;
  onPeer?: () => void;
  onRecordOutcome?: (outcome: "approved" | "denied") => void;
  /** Sits inside the packet card instead of its own card. */
  embedded?: boolean;
}) {
  const [letter, setLetter] = useState(panel.appeal?.draft ?? "");
  const [copied, setCopied] = useState(false);
  const fields = [
    { label: "Insurer", value: [panel.insurerName, panel.plan].filter(Boolean).join(" · ") },
    {
      label: "Reference",
      value: panel.reference ? (
        <span className="inline-flex items-center gap-2">
          <span className="font-mono text-caption">{panel.reference}</span>
          <Button
            variant="ghost"
            aria-label="Copy reference"
            onClick={() => {
              void navigator.clipboard?.writeText(panel.reference ?? "");
              setCopied(true);
            }}
          >
            <Copy size={14} />
            {copied ? "Copied" : "Copy"}
          </Button>
        </span>
      ) : (
        "—"
      ),
    },
    { label: "Submitted", value: panel.submittedLabel ? `${panel.submittedLabel} · ${panel.submittedBy}` : "—" },
    {
      label: "Latest answer",
      value: panel.latestLabel ? (
        <span>
          <Chip>{panel.latestLabel}</Chip>
          {panel.latestRaw && <span className="text-fg-2"> “{panel.latestRaw}”</span>}
        </span>
      ) : (
        "—"
      ),
    },
    { label: "Last checked", value: panel.lastCheckedLabel ?? "—" },
    {
      label: "Next check",
      value: (
        <span className="inline-flex items-center gap-2">
          <span>{panel.nextCheckLabel ?? "—"}</span>
          {onCheckNow && (
            <Button variant="secondary" onClick={onCheckNow}>
              Check now
            </Button>
          )}
        </span>
      ),
    },
  ];
  if (panel.approval) {
    fields.push({
      label: "Approval",
      value: (
        <span className="inline-flex items-center gap-1">
          {panel.approval.matched && <Check size={14} className="text-good" aria-label="Approval matches" />}
          <span className="tabular">
            {panel.approval.number} · {panel.approval.cpt} · {panel.approval.units} · {panel.approval.validFrom} to {panel.approval.validTo}
          </span>
        </span>
      ),
    });
  }

  return (
    <section data-review="Insurer" className={embedded ? "mt-4 border-t border-line pt-4" : "rounded-block border border-line-strong bg-panel px-6 py-5"}>
      {!embedded && (
        <div className="mb-4 flex items-baseline gap-2">
          <h2 className="text-block text-fg">Insurer</h2>
          <Chip className="ml-auto">{panel.channelLabel}</Chip>
        </div>
      )}
      <PropertyList items={fields} />
      {panel.sent.length > 0 && (
        <div className="mt-3">
          <div className="text-caption text-fg-2">Sent</div>
          {panel.sent.map((item) => (
            <div key={`${item.label}-${item.pages}`} className="text-body text-fg">
              {item.label} · pages {item.pages}
            </div>
          ))}
          {panel.packetUrl && (
            <a className="text-body text-accent-fg" href={panel.packetUrl}>
              Packet as sent
            </a>
          )}
        </div>
      )}
      <div className="mt-3">
        {panel.timeline.map((row) => (
          <TimelineRow key={row.id} row={row} />
        ))}
      </div>
      {panel.appeal && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="text-body text-fg">“{panel.appeal.reason}”</div>
          <div className="text-caption text-fg-2">
            {[panel.appeal.deadline, panel.appeal.daysLeft].filter(Boolean).join(" · ")}
          </div>
          <textarea
            aria-label="Appeal letter"
            value={letter}
            onChange={(event) => setLetter(event.target.value)}
            className="mt-2 h-24 w-full rounded-md border border-line bg-panel p-2 text-body text-fg outline-none"
          />
          {panel.appeal.reference && <div className="mt-2 font-mono text-caption text-fg-2">{panel.appeal.reference}</div>}
          <div className="mt-2 flex flex-wrap gap-2">
            {onFileAppeal && (
              <Button variant="secondary" onClick={() => onFileAppeal(letter)}>
                File appeal
              </Button>
            )}
            {onPeer && (
              <Button variant="secondary" onClick={onPeer}>
                Request peer-to-peer
              </Button>
            )}
            {onCloseDenied && (
              <Button variant="secondary" onClick={onCloseDenied}>
                Close as denied
              </Button>
            )}
            {onRecordOutcome && (
              <>
                <Button variant="secondary" onClick={() => onRecordOutcome("approved")}>
                  Record approved
                </Button>
                <Button variant="secondary" onClick={() => onRecordOutcome("denied")}>
                  Record denied
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function TimelineRow({ row }: { row: InsurerTimelineRow }) {
  const Icon = ICONS[row.kind];
  return (
    <div className="flex min-h-8 items-baseline gap-2 py-1 text-body">
      <Icon size={14} className="shrink-0 text-fg-3" />
      <span className="tabular shrink-0 text-caption text-fg-2">{row.time}</span>
      <span className="text-fg-2">{row.channel}</span>
      <span className="text-fg">{row.result}</span>
      {row.screenshotUrl && (
        <a className="text-accent-fg" href={row.screenshotUrl}>
          Screenshot
        </a>
      )}
      {row.error && <span className="text-bad">{row.error}</span>}
    </div>
  );
}
