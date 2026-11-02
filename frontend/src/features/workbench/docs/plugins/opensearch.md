---
id: opensearch
description: Read what the application under test sent to OpenSearch, the matching documents in Search mode or numbers worked out from them in Aggregate mode, and hand them back as a table
versions:
  - version: "1.0.0"
    releaseDate: "2026-09-26"
    changelog:
      - "Search: the matching documents with the fields you pick, sorted, up to Max results, paging past 10,000 in sort order"
      - "Aggregate: a count, sum, average, min, max, percentile, unique count or increase per time slot and / or field value, set in a plain form"
      - "From and To as in the OpenSearch Dashboards date picker: Absolute, Relative or Now, all in UTC"
      - "Query in DQL or Query DSL, with WAVE variables escaped for where they land, or as an expression"
      - "Every run checks the index pattern and the field names against the cluster, so a typo cannot pass as zero results"
      - "Sign in with a username and password, an API key, a bearer token or a client certificate; TLS with Verify Server Certificate, CA Certificate, Client Certificate and Client Key"
      - "Query editor: DQL and JSON coloring, checks while typing, field suggestions and Get fields"
      - "Remotable: inside a Remote Execution body the block runs on the remote host, which needs nothing installed; SSH tunnels work too"
      - "On error: Fail the block, or Record and continue with Success, Error and Reason"
---

The OpenSearch plugin reads what the application under test wrote to an OpenSearch cluster, such as log lines and events, and the numbers OpenSearch works out from them, such as a count per minute or an average. It is one block with two modes, Search and Aggregate. It only reads: it never creates, changes or deletes anything in OpenSearch, and it writes no files. It works with OpenSearch 1.x, 2.x and 3.x, on the WAVE server, on a remote host inside a Remote Execution body, and through an SSH tunnel.

**Which mode:**

Search returns the matching log lines or documents, one row each, with the fields you pick. Aggregate returns numbers OpenSearch works out from the matching documents: a count, sum, average, percentile and more, for the whole window or split per time slot or per value of a field. You describe the numbers in a simple form; you do not write JSON. You get numbers back, not the documents behind them. Both modes return the same two things: Results, a table, and Total results, the exact number of matching documents. For one count of all matching lines, either mode is enough: check Total results.

| You want | Mode | You check |
|----------|------|-----------|
| The lines themselves: an error, the final line, a test's whole log | Search | Results |
| One count of matching lines, such as the errors in the window | Search or Aggregate | Total results |
| A count per minute or per value, or a sum, average, percentile, unique count or how much a counter grew | Aggregate | Results |

The Mode row sits right after Query. It shows only the rows of the chosen mode.

**Use Cases:**
- Wait until the application logs its final line or an error, with a Wait Until around a Search
- Collect every log line a test produced, from the test's start to its final line
- Count the errors in a window and check the count with Assert
- Count errors per minute and check that no minute had too many
- Check an average, a percentile or how much a counter grew during the test
- Find a document by its ID or a trace ID and check its fields
- Reach a cluster that only a remote host or an SSH tunnel can see

**Search:**
- Returns the documents in Index pattern whose Time field is between From and To and that match Query: the log lines, events or records the application wrote
- Results holds one row per document and one column per entry in Fields, in the order listed. By default Fields holds `@timestamp`, so the time is the first column; remove it if you do not want it. With Fields empty, Results has one column holding the whole document
- A nested object comes back as one column per field, named with dots and in name order, such as `user.id` and `user.name`, as Discover shows them. An array is JSON text in its cell. A field a document lacks is an empty cell. An empty result keeps its columns, so a check on a column still finds it
- Total results is the exact number of matching documents, whatever Max results says
- Rows only Search has: Fields, Max results, and the Sort section with Sort by and Order. The Sort section is closed by default. Unless you change it, lines come newest first by the Time field
- Use it when you want the lines, or how many lines match. For a count, set Max results to 1 so Results stays small, and check Total results
- To find a document by its ID, add the ID to Query: `_id: "abc123"` in DQL, or `{"ids": {"values": ["abc123"]}}` in Query DSL. If no document has that ID, Results is empty, Total results is 0 and the block still passes. Add an Assert on Total results if that should fail the test
- To keep the lines as a file, pass Results to the CSV block. The OpenSearch block writes no files

**Search example: wait for the final line or an error, then collect the logs:**

The application writes `Batch complete` as its last line, or an `ERROR` line when it fails. The test waits for either one, branches on which it was, then collects every line from the test's start to that line.
1. Early in the test, a Python or Shell Script block saves the start time in UTC to a variable, `test_start`. WAVE expressions cannot read the current time, so a script block records it
2. A Wait Until in Retry mode holds a Search in its retry lane:
   - Index pattern `app-logs-*`, From `test_start` with {} (the row set to take a variable; see From and To), To Now
   - Query language DQL, Query `log.level: "ERROR" or message: "Batch complete"`
   - Mode Search, Fields `@timestamp`, `log.level`, `message`, Order Oldest first, Max results 1
   - Results bound to `final`, Total results bound to `found`
   - The wait's condition is `found >= 1`. Each round asks for one line only, so the rounds stay cheap
3. An If/Else checks `final.cell(0, 'log.level') == 'ERROR'`; when it is true the test takes the error branch, otherwise the success branch
4. A Delay of 5 seconds lets lines still on their way reach the cluster
5. A second Search collects every line in the window: the same Index pattern, From `test_start` with {}, To `final.cell(0, '@timestamp')` with {}, Fields `@timestamp`, `log.level`, `message`, the Query for the lines you want or empty for all, Order Oldest first, and Max results 0 to keep every line. Results now holds every line the application wrote during the test; pass it to the CSV block to save it as a file

Keep From fixed inside a retry lane: take the test's start time from a variable. A relative From such as `now-15m` can match lines from before the test started, such as a previous run's final line.

**Aggregate:**
- Returns numbers OpenSearch works out from the documents in Index pattern whose Time field is between From and To and that match Query. The documents themselves are not returned
- Rows only Aggregate has: Group by time, Group by field, Top values and Stats
- Group by time splits the window into time slots: No, or Every 10 seconds, 30 seconds, 1 minute, 5 minutes, 15 minutes or 1 hour (default: Every 1 minute). No gives one row for the whole window
- Group by field splits by the values of one field, such as `service.name`: one row per value (default: No field). Top values is how many of the most common values get a row (default: 10). When documents fall outside those values, the run console says how many as a WARN line
- With both set, you get one row per time slot and value
- Stats is the list of numbers you want, one column each. It starts with Count. Add stat adds another; each entry reads in words, such as `95th percentile of latency_ms`, and opens a small popover where you pick the stat and its field
- Use it when the check is about a number OpenSearch works out from many lines, such as a count per minute, an average, a percentile or how much a counter grew. For one plain count of matching lines, Total results is simpler

**Stats:**

| Stat | What you get | Column name |
|------|--------------|-------------|
| Count | How many documents match. Needs no field | `count` |
| Sum | The sum of a field | `sum of latency_ms` |
| Average | The average of a field | `average of latency_ms` |
| Min | The lowest value of a field | `min of latency_ms` |
| Max | The highest value of a field | `max of latency_ms` |
| Percentile | The value below which a given percent of the field's values fall. Set Percent, such as 95 | `percentile 95 of latency_ms` |
| Unique count | How many different values a field has, such as distinct users. Approximate when a field has very many different values, as OpenSearch computes it | `unique count of user.id` |
| Increase | How much a running total, such as a request counter, grew. When the counter drops because the application restarted, that drop is skipped, not counted | `increase of requests_total` |
| Custom (JSON) | Anything the list does not offer: one OpenSearch aggregation written as JSON in the editor | Shown in the stat's popover |

**Results in Aggregate:**
- One row per time slot, per field value, or per slot and value; one row for the whole window when there is no grouping
- The time column is named after the Time field, such as `@timestamp`. The value column is named after the grouped field. Each stat adds one column
- A time slot with no documents shows 0, so a quiet minute is still a row
- The run console shows the summary line and any warnings, never the data; the rows are in Results

**Aggregate example: errors per minute over the test window, then check the busiest minute:**

The test should never see more than 5 errors in one minute.
1. Early in the test, save the start time to `test_start`, as in step 1 of the Search example
2. After the part of the test that makes the load, an OpenSearch block:
   - Index pattern `app-logs-*`, From `test_start` with {}, To Now
   - Query language DQL, Query `log.level: "ERROR"`
   - Mode Aggregate, Group by time Every 1 minute, Group by field No field, Stats Count
   - Results bound to `errors`. It holds one row per minute:

| @timestamp | count |
|------------|-------|
| 2026-09-25T10:00:00.000Z | 2 |
| 2026-09-25T10:01:00.000Z | 0 |
| 2026-09-25T10:02:00.000Z | 4 |

3. An Assert with an Expression row checks the highest value: `max(errors.col('count')) <= 5`, which passes when no minute held more than 5 errors. Total results holds the errors for the whole window, if you also want a check on the total

**Behavior:**
- The block only reads. It creates no index, writes no document and changes nothing in the cluster. It writes no files either; pass Results to the CSV block for that
- Every block opens its own connection, sends its requests and closes it. There is no connect block: give each block the connection rows, or bind each one to the same OpenSearch profile
- The block does not wait for new lines to appear. A search returns what the cluster holds at that moment. A line the application just wrote becomes searchable after the cluster's next refresh, about a second by default, so to wait for a line put the block inside a Wait Until in Retry mode
- Timeout bounds the whole block, paging included. When it runs out, or when you press Stop, the connection is shut and OpenSearch ends the search, so nothing keeps running on the cluster
- Query opens in the editor with DQL or JSON coloring, `{{ }}` in the variable color, and line numbers. When you stop typing, the editor checks the text. DQL is checked with the same grammar and error messages as OpenSearch Dashboards; a field the cluster does not know gets an amber underline. JSON is checked against OpenSearch's API specification, so an unknown key or a value of the wrong type is underlined. Suggestions offer field names where a field goes, and JSON keys with their allowed values and descriptions. A Custom (JSON) stat opens in the same JSON editor
- Editor findings are warnings: they never block Save or Run; when the block runs, the cluster's answer is what counts. Run in the editor runs this block once with the text as it is now, and Stop stops that run
- Get fields, in the editor footer, reads which indexes Index pattern matches and the fields they hold, with their types. It connects from the WAVE server with the block's rows or bound profile, only when you click it. While it works it reads Getting fields... with a Stop; then Got N fields, then Fields · N with a refresh button; if it fails, Could not get fields, and a message says why. The list is kept while the test is open and offered on Time field, Fields, Sort by, Group by field and a stat's Field, and in the editor. A field list needs an Index pattern: while it is blank, those rows and the editor read Fill in Index pattern to get fields
- Index pattern offers Get indexes: the indexes, aliases and data streams the pattern matches, or, while it is blank, every index the credentials may see. Daily indexes are listed as one wildcard entry: `logs-*, 412 indexes`. Credentials that may not list every index get a message saying so; type the start of a pattern they can read, such as `logs-*`
- Run console: one INFO line per run with the index pattern, the window in UTC, the total results, the results kept (Search) or the rows (Aggregate) and the duration, plus any warnings. The console never shows the data: the documents and numbers are in Results
- Credentials never appear in the run console or in an output

**From and To:**

Every search, in both modes, reads a window on the Time field: `@timestamp` by default, under Advanced, and it must be a date field. Both ends are inclusive. From defaults to 15 minutes ago and To to now. Each row shows its value in words, such as "15 minutes ago", "now" or "Sep 25, 2026 @ 10:42:05". Click it for three tabs, as in the OpenSearch Dashboards date picker:

| Tab | How you set it | What it holds |
|-----|----------------|---------------|
| Absolute | Pick a day on the calendar and a time to the second, or type the timestamp | A fixed UTC time: `2026-09-25T10:42:05Z` |
| Relative | A number, a unit (seconds to years) and ago or from now. Round to the unit rounds to the start of that unit. The value it makes shows underneath | OpenSearch relative time: `now-15m`, or `now-15m/m` rounded to the minute |
| Now | One click | `now` |

- With {} the row takes a variable or an expression instead, holding a timestamp, epoch milliseconds such as `1790332925000`, or relative time such as `now-1h` or `now/d` (the start of today)
- All times are UTC. A timestamp with no zone, such as `2026-09-25T10:42:05`, is read as UTC, and the row shows a muted hint saying so. The run console shows the window in UTC
- Relative time counts from the moment the search runs
- A number that reads as epoch seconds fails the block before anything is sent, with "for seconds, multiply by 1000"
- When From is later than To, or later than now, the block still runs but logs a WARN, because the search cannot find anything
- In Aggregate the time slots cover the whole window, from From to To

**Query languages:**

Query works the same in both modes: it picks the documents Search returns and the documents Aggregate counts.

| Language | What you write | Good for |
|----------|----------------|----------|
| DQL | One line, as in Discover's search bar: `log.level: "ERROR" and service.name: "checkout"` | Everyday filters: a field and a value, `and`, `or`, `not`, parentheses, ranges (`latency_ms >= 500`), wildcards (`host.name: web-*`), a field that exists (`trace.id: *`). A line copied from Discover works unchanged |
| Query DSL | JSON: the query part of a request, such as `{"range": {"latency_ms": {"gte": 500}}}` | Anything DQL cannot say. A whole request pasted in keeps only its query part: what comes back and in what order comes from the block's own rows |

- An empty Query means no filter: every document in the window
- This block does not accept Lucene query syntax, SQL or PPL

**Variables in a query:**

`{{ }}` expressions in Query are filled in on every run. Each value is escaped for the place it lands, so a trace ID or a user name from an earlier block can never change what the query means.

| Where the `{{ }}` sits | Example | Value | What is sent |
|------------------------|---------|-------|--------------|
| DQL, inside quotes | `trace.id: "{{ trace }}"` | `a1"b` | The text `a1"b`, its quote escaped |
| DQL, outside quotes | `user.name: {{ user }}` | `ann or bob` | One value, `ann or bob`, never two names. A `*` you type beside it stays a wildcard |
| JSON, inside a string | `{"term": {"trace.id": "{{ trace }}"}}` | `a1"b` | JSON-escaped text |
| JSON, standing alone | `"gte": {{ limit }}` | `500` | The value in JSON form: a number stays a number, text becomes a quoted string, a list becomes an array |

One value cannot go into DQL outside quotes: a lowercase "not" followed by a space. DQL reads it as NOT, even inside a word such as "cannot stop", and has no way to escape it. The block then fails before sending anything and names the `{{ }}` to put inside quotes, for example `user.name: "{{ user }}"`. A capital "Not" or "NOT" is fine.

**Query as an expression:**

Like the SQL row of the SQL block, Query has the {} toggle. With {} on, the row holds an expression instead of the query text, and the expression's result is the query: DQL text, or for Query DSL a map or JSON text. Use it when the query itself is built from earlier values. The escaping above applies only to the text form, because an expression builds the whole query itself.

**Max results and paging (Search):**
- Max results is how many lines Results keeps: 10,000 by default, and 0 keeps every line
- OpenSearch returns at most 10,000 documents per request. For more, the block asks again in sort order, starting after the last line it got. Lines with the same timestamp are ordered by document ID, so no line is skipped or returned twice
- When more lines match than Max results, Results keeps the first ones in sort order and the run console shows `Kept N of M results (Max results)` as a WARN line. The block still passes
- Total results is exact at any size

**Checks on every run:**

OpenSearch answers a search on a field it does not know with no results and no error, so a typo in a field name looks like a search that found nothing, and the test can pass. To catch this and similar problems, every run makes these checks:

| Check | When it fails | Result |
|-------|---------------|--------|
| Index pattern matches an index | No index matches | The block ends amber, with a WARN naming the pattern |
| Every field named in Query, Fields, Sort by, Time field, Group by field and Stats is known to the cluster | A field is unknown, often a typo | The block ends amber, with a WARN naming the field |
| Time field is a date field | It is not | The block fails with reason Validation, naming the field |
| Every shard answered | Some shards failed, or the search timed out on the cluster | Partial results: the block ends amber, with a WARN naming the failed shards or the timeout |
| Top values covers every document (Aggregate) | Some documents fall outside the kept values | The block runs and logs a WARN with how many were left out |
| From and To make sense | From is later than To, or later than now | The block runs and logs a WARN naming both ends in UTC |

**Failure reasons:**

What a failure does depends on On error: Fail the block stops the test; Record and continue sets Success to false, fills Error and Reason, and the test goes on.

| Reason | When | The message |
|--------|------|-------------|
| Unreachable | The host, the port or the TLS handshake does not answer | Names the host and the port tried, with the network's own text |
| AuthFailed | The cluster does not accept the credentials (any 401, including a plain `Unauthorized`) or does not let them do this (a 403 security exception) | OpenSearch's own words: the error's type and reason, or for a plain-text answer its status and first line, such as `HTTP 401: Unauthorized` |
| RequestFailed | OpenSearch refuses the request: a query it cannot parse, a field of the wrong type for the query, a setting it rejects | OpenSearch's own words: the type and reason of the error's first root cause. When every shard failed, it shows OpenSearch's summary, then the first root cause and the query as sent, so you can see the Query DSL your DQL line was turned into |
| Timeout | The block ran past Timeout | How long it ran; the search is ended on the cluster |
| Validation | A row is filled in a way that cannot work. Most are caught before anything is sent; a Dashboards address and a Time field that is not a date are caught from the cluster's first answer | Names the row and what to change: a `{{ }}` value that broke the query, a Query that does not parse, credentials inside the URL, more than one credential set, a time in epoch seconds |

**Connection and authentication:**
- Cluster URL is the cluster's REST address, usually port 9200: `https://opensearch.internal:9200`. https uses TLS and http does not. A path after the port is kept, for a cluster behind a proxy. With no port, https uses port 443 and http uses port 80, not 9200; an Unreachable error names the port it tried. A username or password written inside the URL is refused
- The block talks to the cluster, never to OpenSearch Dashboards. A Dashboards address gets: "This is the OpenSearch Dashboards address. The block needs the cluster address, usually port 9200"
- Authentication is collapsed. Fill at most one of these:

| Fill | For |
|------|-----|
| Username and Password | A login name and password |
| API Key | A cluster that issues API keys (OpenSearch 3.7 and later) |
| Bearer Token | A JSON Web Token or another token the cluster accepts |
| Nothing | An anonymous cluster, or one with security off |

- All three go in the same Authorization header, so filling more than one fails the block before anything is sent, with reason Validation. A value pasted with its prefix, such as `Bearer eyJ...`, gets an amber note, because WAVE adds that prefix itself
- TLS / Certificates is collapsed and has no on/off switch: an https URL uses TLS and an http URL does not. Its rows are Verify Server Certificate (on by default), CA Certificate, Client Certificate and Client Key. They are used only for an https URL; filled on an http URL they show an amber note that they are not used. A client certificate goes with any of the credentials above
- An OpenSearch profile carries the Cluster URL, the credentials and the TLS rows. Index pattern, the time range, the query, Mode and its rows, Time field and the timeouts stay on the block. A profile is never required

**Where the block runs:**

| Where | How |
|-------|-----|
| WAVE server | Where the block runs outside a Remote Execution body |
| A remote host | Inside a Remote Execution body the block runs on the remote host and carries the R badge. The host needs nothing installed: WAVE's own OpenSearch client travels with the run and uses only the Python the host already has. DQL is turned into Query DSL there, where the block reaches the cluster |
| Through an SSH tunnel | A Cluster URL on `127.0.0.1` or `localhost` at the Local Port of an open tunnel goes through that tunnel, as SQL and Netcat do. The certificate name check and the request's Host header use the tunnel's Remote Host, not `localhost`, so a cluster behind a proxy that routes by host name still answers |

Get fields always runs from the WAVE server.

Requests made from the WAVE host follow Settings > Network > Proxy, the ones Get fields makes included. A block on a remote host does not use that setting.

**Parameters:**
- **Cluster URL**: The cluster's REST address with scheme and port: `https://opensearch.internal:9200` (required)
- **Index pattern**: Where to look: one index, a wildcard such as `logs-*`, a comma list, exclusions with a leading minus, an alias, a data stream, or a date-math name such as `<logs-{now/d}>` for today's daily index. Sent as written; OpenSearch resolves it (required)
- **From**: Start of the window: Absolute, Relative or Now, or a variable or expression with {} (default: 15 minutes ago, `now-15m`)
- **To**: End of the window: Absolute, Relative or Now, or a variable or expression with {} (default: now)
- **Query language**: DQL or Query DSL (default: DQL)
- **Query**: A DQL line or the query part of a Query DSL request; with {}, an expression that gives the query; empty means no filter
- **Mode**: Search returns the matching documents; Aggregate returns numbers worked out from them (default: Search)
- **Fields**: The fields that come back, one column each, in this order; nested fields with dots, such as `user.name`. Empty returns the whole document as one column (default: `@timestamp`) (Search)
- **Max results**: Lines Results keeps; 0 keeps every line (default: 10000) (Search)
- **Group by time**: No, or Every 10 seconds, 30 seconds, 1 minute, 5 minutes, 15 minutes or 1 hour (default: Every 1 minute) (Aggregate)
- **Group by field**: A field whose values each get their own rows (default: No field) (Aggregate)
- **Top values**: How many of the grouped field's most common values get rows (default: 10) (Aggregate)
- **Stats**: The numbers to work out, one column each: Count, Sum, Average, Min, Max, Percentile, Unique count, Increase or Custom (JSON) (default: Count) (Aggregate)
- **Timeout**: Seconds for the whole block, paging included; when it runs out the search is ended on the cluster (default: 300)
- **Sort by**: The field to sort on; any sortable field (default: the Time field) (Sort, Search)
- **Order**: Newest first or Oldest first (default: Newest first) (Sort, Search)
- **Username**: Login name (Authentication)
- **Password**: A secret, masked everywhere (Authentication)
- **API Key**: An API key the cluster issued; a secret (Authentication)
- **Bearer Token**: A token such as a JSON Web Token; a secret (Authentication)
- **Verify Server Certificate**: Check the cluster's certificate against CA Certificate when one is given, otherwise against the certificates WAVE trusts (Settings > Network > Certificates) (default: on) (TLS / Certificates, https only)
- **CA Certificate**: The CA certificate: a file path, a variable reference or a PEM string; when set, it is the only certificate this block trusts (TLS / Certificates, https only)
- **Client Certificate**: A client certificate for mutual TLS: a file path, a variable reference or a PEM string (TLS / Certificates, https only)
- **Client Key**: The private key of the client certificate: a file path or a PEM string; a secret (TLS / Certificates, https only)
- **Time field**: The date field the window reads (default: `@timestamp`) (Advanced)
- **Connect timeout**: Seconds to wait for the cluster to accept the connection and finish the TLS handshake (default: 30) (Advanced)
- **On error**: Fail the block, or Record and continue (default: Fail the block) (Failure Handling)

**Outputs:**
- **Success**: True when the block finished; false when the block failed and On error is Record and continue
- **Results**: A table. Search: one row per matching document and one column per entry in Fields. Aggregate: one row per time slot and / or field value, or one row for the whole window, with one column per stat. In Search, empty when nothing matched, with its columns kept
- **Total results**: The exact number of matching documents, whatever Max results says
- **Error**: The failure message (Record and continue only)
- **Reason**: Unreachable, AuthFailed, RequestFailed, Timeout or Validation; empty when the block passed (Record and continue only)
