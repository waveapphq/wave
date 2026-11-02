/**
 * PythonHelpPopover - the F1 help over the Python script body (PYRUN-13): the
 * keyboard list, and the tips, collapsed behind a Show tips toggle.
 *
 * REQ-3.4.1.2: Python script execution
 * REQ-3.4.2.2: Plugin parameter definition
 */

import { useState } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ScriptHelpPopover,
  type ScriptHelpPopoverProps,
} from "./script-help-popover";

interface Tip {
  text: string;
  example?: string;
}

interface TipSection {
  heading: string;
  tips: Tip[];
}

const TIP_SECTIONS: TipSection[] = [
  {
    heading: "Inputs",
    tips: [
      {
        text: "Input Variables are globals",
        example: "limit = float(threshold)",
      },
      {
        text: "A table iterates as row dicts",
        example: 'for row in readings: row["temp_c"]',
      },
      { text: "Floats arrive as Decimal", example: "float(price) * 2" },
    ],
  },
  {
    heading: "Outputs",
    tips: [
      {
        text: "Assign a name to fill a Variable Export",
        example: 'summary = {"mean": mean_temp}',
      },
      {
        text: "A list of dicts fills a table export",
        example: 'rows = [{"id": 1, "ok": True}]',
      },
      { text: "Exports are read even when the script raises" },
    ],
  },
  {
    heading: "Logging and failure",
    tips: [
      {
        text: "logging goes to the run console, print to Stdout",
        example: 'logging.info("done %d", count)',
      },
      {
        text: "An exception or a failed assert fails the block with its traceback",
        example: 'assert ok, "no rows"',
      },
      { text: "sys.exit ends with that exit code", example: "sys.exit(2)" },
    ],
  },
  {
    heading: "Files and modules",
    tips: [
      {
        text: "Modules in the Working Directory import by name",
        example: "import helpers",
      },
      {
        text: "Test Data and Artifacts folders come from the environment",
        example: 'os.environ["WAVE_TESTDATA_DIR"]',
      },
    ],
  },
];

function TipList({ section }: Readonly<{ section: TipSection }>) {
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {section.heading}
      </h4>
      <ul className="space-y-1">
        {section.tips.map((tip) => (
          <li key={tip.text} className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">{tip.text}</span>
            {tip.example !== undefined && (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
                {tip.example}
              </code>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Owns the tips toggle so closing the popover collapses them again. */
function PythonTips() {
  const [showTips, setShowTips] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-expanded={showTips}
        onClick={() => setShowTips((open) => !open)}
        className="w-fit text-xs text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid"
      >
        {showTips ? "Hide tips" : "Show tips"}
      </button>
      {showTips && (
        // A height, not a cap: the h-full viewport grows past a cap and clips.
        <ScrollArea className="h-64 shrink-0">
          <div className="flex flex-col gap-3 pr-3">
            {TIP_SECTIONS.map((section) => (
              <TipList key={section.heading} section={section} />
            ))}
          </div>
        </ScrollArea>
      )}
    </>
  );
}

export function PythonHelpPopover(props: Readonly<ScriptHelpPopoverProps>) {
  return (
    <ScriptHelpPopover mode="python" {...props}>
      <PythonTips />
    </ScriptHelpPopover>
  );
}
