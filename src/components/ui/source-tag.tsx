import { Tip } from "./tooltip";

/** "[epic]": the value did not come from the PDF. Hover shows when the external check last ran. */
export function SourceTag({ system = "epic", lastRun }: { system?: string; lastRun?: string }) {
  return (
    <Tip content={lastRun ? `${system} · checked ${lastRun}` : system}>
      <span data-chip className="inline-flex h-5 items-center rounded-md bg-chip px-1 text-caption text-fg-2">
        [{system}]
      </span>
    </Tip>
  );
}
