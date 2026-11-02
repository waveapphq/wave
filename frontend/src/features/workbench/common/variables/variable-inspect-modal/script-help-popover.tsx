/**
 * ScriptHelpPopover - the F1 help over a script body: its keyboard list, plus
 * whatever the mode adds under it (PYRUN-13, SQL-10, OS-12).
 *
 * REQ-3.4.1.2: Python script execution
 * REQ-3.4.1.6: SQL database operations
 * REQ-3.3.2.6: OpenSearch query editor
 */

import { type ReactNode, type RefObject, useId, useRef } from "react";
import { X } from "lucide-react";

import { Kbd } from "@/components/ui/kbd";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
interface Shortcut {
  /** One entry per alternative chord; the chords read `Tab / Shift Tab`. */
  chords: string[][];
  label: string;
}

const AUTOCOMPLETE: Shortcut = { chords: [["Ctrl", "Space"]], label: "Autocomplete" };
const RUN: Shortcut = { chords: [["Shift", "Enter"]], label: "Run" };
const SAVE_AND_CLOSE: Shortcut[] = [
  { chords: [["Ctrl", "Enter"]], label: "Save" },
  { chords: [["Esc"]], label: "Close" },
];
const RENAME: Shortcut = { chords: [["F2"]], label: "Rename symbol" };
const TOGGLE_COMMENT: Shortcut = { chords: [["Ctrl", "/"]], label: "Toggle comment" };
const EDITING_SHORTCUTS: Shortcut[] = [
  { chords: [["Ctrl", "F"]], label: "Find and replace" },
  { chords: [["Ctrl", "G"]], label: "Go to line" },
  { chords: [["Tab"], ["Shift", "Tab"]], label: "Indent / outdent" },
  {
    chords: [
      ["Ctrl", "Z"],
      ["Ctrl", "Y"],
    ],
    label: "Undo / redo",
  },
];

/** The editors whose help lists its own keys: only keys that work in that editor. */
type HelpMode = "python" | "sql" | "opensearch" | "aggregation";

// SQL-10, OS-12: SQL drops F2 Rename; DQL and JSON have no comments; a Custom (JSON) stat never runs.
const SHORTCUTS: Record<HelpMode, Shortcut[]> = {
  python: [AUTOCOMPLETE, RUN, ...SAVE_AND_CLOSE, RENAME, TOGGLE_COMMENT, ...EDITING_SHORTCUTS],
  sql: [AUTOCOMPLETE, RUN, ...SAVE_AND_CLOSE, TOGGLE_COMMENT, ...EDITING_SHORTCUTS],
  opensearch: [AUTOCOMPLETE, RUN, ...SAVE_AND_CLOSE, ...EDITING_SHORTCUTS],
  aggregation: [AUTOCOMPLETE, ...SAVE_AND_CLOSE, ...EDITING_SHORTCUTS],
};

function ShortcutRow({
  mode,
  shortcut,
}: Readonly<{ mode: HelpMode; shortcut: Shortcut }>) {
  return (
    <div data-testid={`${mode}-help-key-row`} className="flex items-center gap-3">
      <span className="flex shrink-0 items-center gap-1">
        {shortcut.chords.map((chord, index) => (
          <span key={chord.join("+")} className="flex items-center gap-1">
            {index > 0 && <span className="text-muted-foreground">/</span>}
            {chord.map((key, keyIndex) => (
              <span key={key} className="flex items-center gap-1">
                {keyIndex > 0 && (
                  <span className="text-muted-foreground">+</span>
                )}
                <Kbd>{key}</Kbd>
              </span>
            ))}
          </span>
        ))}
      </span>
      <span
        data-testid={`${mode}-help-key-label`}
        className="text-xs text-muted-foreground"
      >
        {shortcut.label}
      </span>
    </div>
  );
}

export interface ScriptHelpPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The element the popover points at (the F1 chip). */
  anchor: HTMLElement | null;
  /** Fired once the popover is gone, so the host can take focus back. */
  onClosed: () => void;
}

export function ScriptHelpPopover({
  mode,
  open,
  onOpenChange,
  anchor,
  onClosed,
  children,
}: Readonly<ScriptHelpPopoverProps & { mode: HelpMode; children?: ReactNode }>) {
  const headingId = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  anchorRef.current = anchor;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={anchorRef as RefObject<HTMLElement>} />
      <PopoverContent
        data-testid={`${mode}-help-popover`}
        aria-labelledby={headingId}
        side="top"
        align="start"
        // The host decides where focus lands, so the popover never hands it back.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onClosed();
        }}
        // Held to the room the chip leaves, so the header and its X stay on screen.
        className="w-96 max-w-[90vw] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto"
      >
        <button
          type="button"
          aria-label="Close help"
          onClick={() => onOpenChange(false)}
          className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <div className="flex flex-col gap-3">
          <h3
            id={headingId}
            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Keyboard
          </h3>
          <div className="flex flex-col gap-1.5">
            {SHORTCUTS[mode].map((shortcut) => (
              <ShortcutRow key={shortcut.label} mode={mode} shortcut={shortcut} />
            ))}
          </div>
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The SQL editor's help: the keyboard list alone, no tips (SQL-10). */
export function SqlHelpPopover(props: Readonly<ScriptHelpPopoverProps>) {
  return <ScriptHelpPopover mode="sql" {...props} />;
}

/** The OpenSearch Query editor's help (DQL, Query DSL): the keyboard list alone, no tips (OS-12). */
export function OpenSearchHelpPopover(props: Readonly<ScriptHelpPopoverProps>) {
  return <ScriptHelpPopover mode="opensearch" {...props} />;
}

/** A Custom (JSON) stat editor's help: the keyboard list alone, no Run (OS-7, OS-12). */
export function AggregationHelpPopover(props: Readonly<ScriptHelpPopoverProps>) {
  return <ScriptHelpPopover mode="aggregation" {...props} />;
}
