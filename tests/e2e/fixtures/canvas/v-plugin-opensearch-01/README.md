# V-PLUGIN-OPENSEARCH-01: OpenSearch Block Config Sheet

Verify the OpenSearch config sheet in Search and Aggregate mode, its groups, its amber notes and row checks, the From / To time picker, the Fields and Stats editors with the Stats entry popover, the outputs, and the Query row under Query DSL.

## Prerequisites

No seed script and no OpenSearch service. Each test persists its own Test and deletes it afterwards. The Tests hold one OpenSearch block (Cluster URL `https://opensearch.internal:9200`, Index pattern `filebeat-*`) with nothing else stored but:

- search, toggles, url editor, outputs: Query `log.level:ERROR or message:"Login failed"` and Fields `@timestamp`, `log.level`, `message`
- groups: the same plus Username `wave-qa`
- blank: nothing at all (persisted through the admin bulk route, because POST /tests refuses it)
- notes: Cluster URL `http://opensearch.internal:9200` and a CA Certificate
- stats: Mode `aggregate`, Stats `Count` and `Percentile` of `latency_ms` at 95
- retry lane: a Wait Until in Retry mode with the block on its retry lane, From `now-15m`
- from checks: four blocks, From `1790332925`, `yesterday`, `2026-09-25T10:42:05`, and From `2026-09-25T11:00:00Z` with To `2026-09-25T10:00:00Z`

## Steps

1. Open the Test at http://localhost:3000/workbench?editTest=<id> and open the OpenSearch config sheet
2. search: read the sheet as it opens
3. toggles: expand every group and read the {} toggles; open the Fields editor from the Fields expand
4. blank: read the flagged rows, the Save button, the note under it and the empty Cluster URL's hint
5. aggregate: open the Fields editor, add the entries `log.level` and `message` with Add field, Save and Close it; set Mode to Aggregate, open Group by time and the Stats editor, set Mode back to Search, then Save the sheet and the Test
6. groups: expand Authentication and Advanced, type `event.created` into the Time field key by key, expand TLS / Certificates, then Save the sheet and the Test
7. notes: type `ApiKey abc` into API Key and `Bearer x` into Bearer Token; expand TLS / Certificates
8. retry lane: open the block on the retry lane
9. url editor: open the Cluster URL's Edit value sheet
10. from: open From from its expand, tick Round to the minute, press the picker's Save, Save the sheet and the Test; reopen, type `2026-09-25T10:42:05Z` into Date and time on Absolute and press Save; open From, pick Now and press Esc; open it, pick Now and press Cancel; open it, pick Now and press Save; Save again
11. from checks: open each of the four blocks
12. stats: open the Stats editor from its expand, open the second entry, set Stat to Custom (JSON), press Esc, click Add stat, press Esc, Save and Close the editor, Save the sheet and the Test
13. outputs: set On error to Record and continue, then back to Fail the block
14. query dsl: open Query, type `log.level: ERROR` and Save; set Query language to Query DSL and open Query again; Save the sheet and the Test

## Validation

- **Header:** SearchCode glyph in purple, title "OpenSearch - Edit Config", Version 1.0.0
- **Search:** Cluster URL*, Index pattern*, From (`now-15m` in gray, clock glyph), To (`now` in gray), Query language (DQL), Query, Mode (Search), Fields (one line `["@timestamp", "log.level", "message"]`), Max results (10000 in gray), Timeout (300 in gray); Sort, Authentication, TLS / Certificates, Advanced, Failure Handling and Secrets collapsed
- **Toggles:** {} on every row but Query language, Mode and On error; one on each entry in the Fields editor
- **Blank block:** the server names Cluster URL and Index pattern; both flagged on open; Save disabled with "Save is disabled: the settings have errors"; the empty Cluster URL shows the italic gray hint `https://opensearch.internal:9200`
- **Aggregate:** Group by time (Every 1 minute; No, Every 10 seconds, Every 30 seconds, Every 1 minute, Every 5 minutes, Every 15 minutes, Every 1 hour), Group by field (hint No field), Top values (10 in gray), Stats (its editor holds Count with the sigma glyph and Add stat) in place of Fields, Max results and Sort; outputs unchanged; back on Search the three Fields entries are there and are saved
- **Groups:** Username (`wave-qa`), Password, API Key, Bearer Token (lock glyph on the last three) and the footer "How WAVE identifies itself to the cluster: ..."; Time field (`@timestamp` in gray), Connect timeout (30 in gray); `event.created` typed into the Time field replaces the default, shows reset and is saved; Verify Server Certificate (ticked), CA Certificate, Client Certificate, Client Key (lock glyph), no TLS switch
- **Amber notes:** under API Key two lines, `Remove "ApiKey " at the start: WAVE adds it` then `Secret value stays visible until you save the test.`; under Bearer Token `Remove "Bearer " at the start: WAVE adds it` then the same secret line; "Not used: the Cluster URL is http" under CA Certificate; Save stays enabled
- **Retry lane:** From holds `now-15m` with no note under it
- **Cluster URL editor:** a Kind picker and no Format picker
- **From popover:** a From dialog with the From mode strip (Absolute, Relative, Now); Relative: Amount 15, minutes ago, Round to the minute unticked, `now-15m`; Round shows `now-15m/m` and Save writes it (saved), the field reading `now-15m/m` with the reset icon; Absolute: September 2026 with the 25th selected, 10 : 42 : 05, `2026-09-25T10:42:05Z`, and Save writes it as written; Esc and Cancel write nothing and Esc puts focus back on the expand; Now then Save writes `now` (saved)
- **From checks:** red "From reads as epoch seconds: for seconds, multiply by 1000" with Save disabled; "From is not a time: use Absolute, Relative or Now"; muted "No zone given: read as UTC"; amber "From is later than To: the search can find nothing"
- **Stats:** in the Stats editor, "95th percentile of latency_ms" on one line; Stat 2 holds Percentile, 95, `latency_ms` and `percentile 95 of latency_ms`; Custom (JSON) shows Aggregation (Edit JSON), Column name (placeholder custom 2) and `custom 2`; Add stat opens Stat 3 with focus on Stat, reading "Sum (no field)" and "Pick a field"; the saved Stats are count, custom, sum
- **Outputs:** Success (Boolean), Results (Table), Total results (Integer); Error and Reason (String) only under Record and continue
- **Query DSL:** the Query editor opens in Template; in Literal its Format reads DQL under DQL and Query DSL (locked) under Query DSL; the typed text is kept and saved with Query language `query_dsl`
