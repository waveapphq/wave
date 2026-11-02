# V-PLUGIN-NETCAT-01: Netcat Block Config Sheet

Verify the Netcat config sheet in its four wireframe states: Check, Range, Talk and the output section, plus the File row of a block inside a Remote Execution body.

## Prerequisites

No seed script. Each test imports its own Test through `POST /tests` with the SSH host rewrite, validates it and deletes it afterwards. The Test holds one Netcat block with Host set to the Netcat echo host and Port `9470`, plus:

- check: nothing else (Ports Single, Protocol TCP, Mode Check, Timeout unset)
- range: Port range `22, 80, 8000-8010`, stored while Ports is Single
- talk and talk rules: Mode Talk, Text `GET / HTTP/1.0` followed by a blank line
- outputs: Mode Talk
- remote body: a Remote Execution block whose body holds the Netcat block with Host `netcat-target`, Mode Talk, Send File and File `/tmp/netcat-payload.txt`

## Steps

1. Open the Test at http://localhost:3000/workbench?editTest=<id> and open the Netcat config sheet
2. check: read the sheet, open the Ports, Protocol and Mode selects, expand Failure Handling
3. range: set Ports to Range, open Pass when, set Ports back to Single
4. talk: read the sheet, expand Advanced
5. talk rules: expand Advanced, set Send to Nothing, File, then Text; set Protocol to UDP, then back to TCP
6. outputs: read the output section and the Text row; set Ports to Range, read the Port range row, and set it back to Single; set Mode to Check; set On error to Record and continue; set Mode to Talk; set On error to Fail the block
7. remote body: read the Netcat block's badge on the canvas, open its config sheet and read the File row

## Validation

- **Header:** Cable glyph in the Network blue, title "Netcat - Edit Config"; input table columns Parameter / Type / Value
- **Check:** Host, Ports, Port, Protocol, Mode, Timeout, then Failure Handling and Secrets, both collapsed, Secrets last; Host and Port carry the asterisk; Host is the one value field showing the host; Port shows `9470`; Ports Single (Single / Range), Protocol TCP (TCP / UDP), Mode Check (Check / Talk), none with a toggle; Timeout shows its default 10 in gray with a toggle; no Send, Text, File or Advanced; no settings-errors note under Save
- **Failure Handling:** holds On error, a select on Fail the block
- **Range:** Port gone; Port range (asterisk, String, `22, 80, 8000-8010`, toggle) right after Ports; Pass when on One succeeds (One succeeds / All succeed, no toggle) between Port range and Protocol; no note. Back on Single, Port returns with `9470`
- **Talk:** Host, Ports, Port, Protocol, Mode Talk, Send Text (no toggle), Text (the payload, toggle), Timeout, then Advanced, Failure Handling and Secrets; Advanced collapsed on open
- **Advanced:** CRLF line endings and Close after sending unticked (Boolean, toggle), Max reply size (bytes) with the default 16777216 in gray (Integer, toggle), footer "Line endings, closing and reply size for Talk", above Failure Handling
- **Talk rules:** over TCP Send offers Nothing / Text / File; Nothing shows neither Text nor File; File shows the File row (asterisk, path placeholder, Browse) where Text was and the note "Save is disabled: the settings have errors"; Text brings the payload back and clears the note; over UDP Close after sending is gone and Send offers Text / File only; back on TCP both return
- **Outputs:** columns Parameter / Type / Secret / Assign to; Success (Boolean), Results (Table), Reply (String), each with an unticked Secret box and an empty `variable_name` input; Reply gone for Range and for Check; Error and Reason (String) only under Record and continue
- **Empty defaults:** with nothing stored, Text is an empty value field; after Ports = Range, Port range is empty and the note "Save is disabled: the settings have errors" shows until Ports goes back to Single
- **Remote body:** the Netcat block carries the `R` badge ("Runs on the remote host"); its sheet reads Host, Ports, Port, Protocol, Mode, Send, File, Timeout, then Advanced, Failure Handling and Secrets; the File row (asterisk, toggle) shows `/tmp/netcat-payload.txt` and has no Browse
