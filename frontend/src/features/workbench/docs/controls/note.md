---
id: note
description: Sticky-note annotation for visual documentation
versions:
  - version: "1.0.0"
    releaseDate: "2026-03-11"
    changelog:
      - "Initial release"
      - "Canvas annotation with inline text editing"
      - "User-selectable color presets (yellow, pink, blue, green, slate)"
      - "Pass-through flow connections"
---

The Note control provides sticky-note-style annotations on the workflow canvas.

**Use Cases:**
- Document workflow sections with explanations
- Mark TODO areas in flow design
- Add visual context for team members
- Serve as flow placeholders during design

**Behavior:**
- An input and an output handle, so it can sit in a flow as a placeholder for a future Block; where paths join, it shows one input for each connection coming in, as a Block does
- A run passes the flow straight on, with no outputs and no side effects; a Note nothing connects to is never reached
- Supports inline text editing (double-click)
- Resizable by dragging any edge or corner
- Five color presets for visual organization

**Parameters:**
- `text`: the note's text (empty by default)
- `color`: yellow, pink, blue, green or slate (slate by default)
