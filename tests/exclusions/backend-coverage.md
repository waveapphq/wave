# Backend Coverage Exclusions

This list holds every line that the backend's coverage leaves out. The backend tests measure `backend/wavecore/` and fail below 100% coverage. A line leaves coverage only with `# pragma: no cover - BCOV-XXX-NNN`, and its ID must have an entry here.

This list is one of the exclusion lists in [README.md](README.md), which holds the rules for all of them.

## Correlation Rules

- **Each ID appears at least once in code** - Every `BCOV-*` ID in this list is found in `backend/wavecore/`
- **IDs may be reused for the same cause** - An ID appears at each place where the same reason holds
- **Find a place by searching for the ID** - For example `git grep -n "BCOV-ABSTRACT-001"`
- **IDs never change** - An ID stays the same when its code moves to another file
- **Orphaned IDs are violations** - An ID in this list but not in the code, or in the code but not in this list, is a policy violation

## Exclusion Categories

| Category | Code | Description |
|----------|------|-------------|
| ABSTRACT | `BCOV-ABSTRACT-*` | Bodies of abstract methods that every subclass replaces |
| TYPE | `BCOV-TYPE-*` | Fallback returns for value types that a parser does not expect |
| GUARD | `BCOV-GUARD-*` | Catch-all guards that keep a side task from stopping a run |

---

## Abstract Methods

### BCOV-ABSTRACT-001: Plugin Base Class Abstract Methods

- **Kind**: Intended behavior

The plugin base class declares the three methods that every plugin must have: the plugin's metadata, its run, and the check of its settings. Each one is abstract, so Python refuses to create a plugin that does not replace all three. The base class's own body of each method holds only its description and never runs. Three places carry this ID, one for each method.

---

## Value Type Fallbacks

### BCOV-TYPE-001: Fallbacks for Value Types a Parser Does Not Expect

- **Kind**: Intended behavior

Three conversions turn what a parser library returns into a WAVE value. Each one handles every type it expects, then ends with a fallback that turns any other value into a string, so a value of a new kind becomes text instead of an error. The fallback never drops a value. Three places carry this ID:

- The XML parser's conversion of an XPath result. XPath 1.0 returns only a node-set, a boolean, a number or a string, and the conversion handles each one before the fallback.
- The XML parser's conversion of one node of a node-set to text. The conversion handles elements, which include comments and processing instructions, and strings, which include attribute values and text nodes. A query on the namespace axis gives prefix and URI pairs, which reach the fallback and become their text.
- The type detection that the query parsers share, which the JSON parser uses. A JSON document holds only nulls, booleans, numbers, strings, objects and arrays, and the detection handles each one before the fallback.

---

## Guards

### BCOV-GUARD-001: Live Variable Update When a Function Starts

- **Kind**: Intended behavior

When a Function starts in the workbench, WAVE sends the values its body starts with to the Variable Manager that shows the Function's body. A catch-all guard around that update keeps a failed update from stopping the run: the run goes on, and the Variable Manager misses only that update. The guard covers only this live update, never the Function's own work.
