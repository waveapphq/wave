# Tracked Termination - YAML-Unsafe Variable Regression

Regression test for the architectural bug where a single user plugin returning a YAML-unsafe value (specifically lxml's `_ElementUnicodeResult` - a `str` subclass) would stall the terminal callback and leave a tracked execution frozen at `status: running` forever.

## The bug this prevents

1. XML Parser's XPath `//item[1]/text()` returns an lxml `_ElementUnicodeResult` (a `str` subclass).
2. Engine stored that value as a variable.
3. When the test completed, the terminal callback tried to persist the session snapshot via `yaml.safe_dump`, which refuses `str` subclasses.
4. `RepresenterError('cannot represent an object', 'Alpha')` propagated up and was swallowed as a `WARN`.
5. The execution record was never transitioned from `running` to `passed`.

## What the test does

1. Imports a minimal test fixture containing an XML Parser node whose XPath produces a text-node result.
2. Starts a tracked execution via `POST /executions`.
3. Waits for the execution to reach a terminal status.
4. Asserts the terminal transition happened (status=`passed`, `ended_at` present, `duration` set).

## What the architectural fix guarantees

Even if some OTHER plugin someday returns another YAML-unsafe type:

- `_yaml_safe` in `backend/wavecore/api/services/executions/_storage.py` sanitizes any value at the persistence boundary.
- `_on_workbench_session_terminated` reorders: it flips the execution-record status FIRST, then best-effort-persists the snapshot. A persistence failure cannot stall the state machine.

## Regression rehearsal

To prove this test catches the regression, temporarily undo either fix and re-run:

```bash
# Revert the XML parser coercion (in wavecore/plugins/xml_parser.py):
#   return {"type": "string", "value": xpath_result}  # str subclass leaks
# AND revert the storage boundary coercion (in _storage.py):
#   def _save_snapshot(...): _yaml_write(..., snapshot)  # no _yaml_safe
# AND revert the reorder (in service.py::_on_workbench_session_terminated):
#   _save_snapshot(...) BEFORE _update_execution_status(...)
```

The test will fail with `Execution ... did not reach terminal state within 20000ms`.
