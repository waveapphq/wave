# V-SETTINGS-SECTIONS-FUNCTIONAL: Settings section errors, Data folder and Secret Masking

Proves that a Settings page whose read fails says why and recovers on Try Again (General, for its
Log Level read and for its Secret Masking read, and WAVE Server), that the WAVE Server page names
and copies the data folder WAVE runs on (WSRV-10), and that a Secret Masking reveal switch is held
until Save and then stored by the backend (SETTINGS-18).

- `v-settings-sections-functional.spec.ts` - registered in the `functional-workflow` project.

## Pre-requisites

- E2E stack up (backend + frontend of the worker's stack). No external service from
  `tests/e2e/services/` is needed and no test data is seeded.
- The admin masking and log-level routes reachable (`GET/PUT /admin/secret-masking`,
  `GET /admin/log-level`); neither needs admin mode switched on.
- The spec reads the Secret Masking flags before each test and writes them back after it, so the
  stack's flags are unchanged when it ends.

## Execution

1. Log Level: answer `GET /admin/log-level` with the backend's error envelope (`page.route`, a
   distinctive reason), open Settings > General, remove the route, press Try Again.
2. Secret Masking: the same with `GET /admin/secret-masking`.
3. WAVE Server: the same with `GET /server/status`; wait for one failed status poll before removing
   the route, so the next poll is about five seconds away and Try Again is the read that recovers the
   section.
4. Data folder: read `data_folder` from `GET /server/status`, open Settings > WAVE Server, press the
   Data folder copy button with clipboard permissions granted and read the clipboard back.
5. Secret Masking staged Save: start with "Reveal test variables" off, switch it on, press Save on
   the Logging heading line, reload, switch it off and press Save again. The spec counts the
   `PUT /admin/secret-masking` requests the page sends and reads the flag back through
   `GET /admin/secret-masking` after each step.

## Validation

- **Section error:** the alert icon, exactly the API's reason and one button, "Try Again". On
  General the error stands for the whole page, whichever of its two reads failed: the heading
  "Logging" shows alone, with no Cancel and no Save on its line, the error sits right under that
  line, and there is no other heading, no select and no switch. On WAVE Server the Backend Server
  card is absent.
- **Recovery:** Try Again issues a new read; General shows its three headings (Logging, Time Zone,
  Secret Masking) with Cancel and Save disabled on the Logging line, the Log Level select with the
  level the API reports and the four Secret Masking switches with the stored flags, and both WAVE
  Server cards render with the real backend port and data folder; the error is gone.
- **Polling while failed:** a failed WAVE Server status poll keeps the error on screen.
- **Data folder:** exactly one Data folder row, in the Backend Server card, with the lock icon and
  exactly the absolute path the API reports in a monospace font; the copy button puts exactly that
  path on the clipboard.
- **Masking staged Save:** Cancel and Save start disabled. The switch turned on enables both, sends
  no PUT and the API still reads `false`. Save sends one PUT carrying only `test_variables`; the API
  reads `true`, Cancel and Save are disabled again, and after a reload the switch is still on with
  the "Revealing" cue. Turned off, it is held the same way until Save stores `false`.
