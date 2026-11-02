# SPDX-License-Identifier: Apache-2.0
# Ported from OpenSearch Dashboards 3.8.0, Copyright OpenSearch Contributors and Elasticsearch B.V.
# Licensed under the Apache License, Version 2.0: http://www.apache.org/licenses/LICENSE-2.0
# Upstream: src/plugins/data/common/opensearch_query/kuery/
"""DQL: parse, translate to Query DSL, read what fits at a cursor (REQ-3.3.2.6)."""

from ._cursor import cursor_context
from ._nodes import field_names, field_spans
from ._parser import DqlSyntaxError, parse
from ._translate import to_query

__all__ = [
    "DqlSyntaxError",
    "cursor_context",
    "field_names",
    "field_spans",
    "parse",
    "to_query",
]
