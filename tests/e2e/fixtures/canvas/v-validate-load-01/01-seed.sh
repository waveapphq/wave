#!/bin/bash
# Seed data for V-VALIDATE-LOAD-01: Validation System Comprehensive Tests
#
# Seeds 16 test entities covering all validation scenarios:
# S01: Clean test (no errors)
# S02: Warnings only (REQUIRED_PARAM_MISSING)
# S03: MISSING_LABEL (fixable)
# S04: DANGLING_EDGE (fixable)
# S05: UNKNOWN_BLOCK_TYPE (fixable)
# S06: SELF_LOOP_EDGE (fixable)
# S07: INVALID_VARIABLE (fixable - 3 refactor cases)
# S08: INVALID_VARIABLE_TYPE (fixable)
# S09: Fatal - MISSING_WORKFLOW
# S10: Fatal - INVALID_NODES
# S11: Disabled node skips validation
# S12: Invalid context param (API only)
# S13: Save-time 422 rejection
# S14: MULTIPLE_EDGES (fixable)
# S15: SELF_LOOP + MULTIPLE_EDGES combined
# S16: MISSING_POSITION + INVALID_POSITION
#
# All IDs follow pattern: ad010e00-00NN-00NN-00NN-0000000000NN

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset all data
_reset_all

TIMESTAMP="$(_ts)"

# Seed an environment so the Run / Debug pre-validation tests can pick one
# (Run + Debug split buttons require selectedEnvironment != null).
_add_environment "ad010ee0-0001-0001-0001-000000000001" "Validation Env" "Environment for validation Run/Debug tests"

echo "Seeding 16 validation test entities..."

_bulk tests "[
  {
    \"op\": \"add\",
    \"entity\": {
      \"id\": \"ad010e00-0001-0001-0001-000000000001\",
      \"name\": \"S01 - Clean Test\",
      \"version\": \"1.0.0\",
      \"description\": \"No errors\",
      \"workflow\": {
        \"nodes\": [
          {\"id\": \"n1\", \"type\": \"workflowNode\", \"position\": {\"x\": 400, \"y\": 200},
           \"data\": {\"elementType\": \"http-client\", \"nodeType\": \"plugin\", \"label\": \"My HTTP Call\", \"category\": \"network\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {\"url\": \"https://example.com\", \"method\": \"GET\"}}}}
        ],
        \"edges\": [{\"id\": \"e1\", \"source\": \"start-node\", \"target\": \"n1\"}]
      },
      \"variables\": {},
      \"metadata\": {},
      \"created_at\": \"$TIMESTAMP\",
      \"updated_at\": \"$TIMESTAMP\"
    }
  },
  {
    \"op\": \"add\",
    \"entity\": {
      \"id\": \"ad010e00-0002-0002-0002-000000000002\",
      \"name\": \"S02 - Warnings Only\",
      \"version\": \"1.0.0\",
      \"description\": \"Missing required params\",
      \"workflow\": {
        \"nodes\": [
          {\"id\": \"n1\", \"type\": \"workflowNode\", \"position\": {\"x\": 400, \"y\": 200},
           \"data\": {\"elementType\": \"http-client\", \"nodeType\": \"plugin\", \"label\": \"HTTP Node\", \"category\": \"network\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {}}}}
        ],
        \"edges\": [{\"id\": \"e1\", \"source\": \"start-node\", \"target\": \"n1\"}]
      },
      \"variables\": {},
      \"metadata\": {},
      \"created_at\": \"$TIMESTAMP\",
      \"updated_at\": \"$TIMESTAMP\"
    }
  },
  {
    \"op\": \"add\",
    \"entity\": {
      \"id\": \"ad010e00-0003-0003-0003-000000000003\",
      \"name\": \"S03 - Missing Label\",
      \"version\": \"1.0.0\",
      \"description\": \"Node without a label\",
      \"workflow\": {
        \"nodes\": [
          {\"id\": \"n1\", \"type\": \"workflowNode\", \"position\": {\"x\": 400, \"y\": 200},
           \"data\": {\"elementType\": \"http-client\", \"nodeType\": \"plugin\", \"category\": \"network\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {\"url\": \"https://example.com\", \"method\": \"GET\"}}}}
        ],
        \"edges\": [{\"id\": \"e1\", \"source\": \"start-node\", \"target\": \"n1\"}]
      },
      \"variables\": {},
      \"metadata\": {},
      \"created_at\": \"$TIMESTAMP\",
      \"updated_at\": \"$TIMESTAMP\"
    }
  },
  {
    \"op\": \"add\",
    \"entity\": {
      \"id\": \"ad010e00-0004-0004-0004-000000000004\",
      \"name\": \"S04 - Dangling Edge\",
      \"version\": \"1.0.0\",
      \"description\": \"Edge to non-existent node\",
      \"workflow\": {
        \"nodes\": [
          {\"id\": \"n1\", \"type\": \"workflowNode\", \"position\": {\"x\": 400, \"y\": 200},
           \"data\": {\"elementType\": \"http-client\", \"nodeType\": \"plugin\", \"label\": \"HTTP Call\", \"category\": \"network\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {\"url\": \"https://example.com\", \"method\": \"GET\"}}}}
        ],
        \"edges\": [
          {\"id\": \"e1\", \"source\": \"start-node\", \"target\": \"n1\"},
          {\"id\": \"e-bad\", \"source\": \"n1\", \"target\": \"ghost-node\"}
        ]
      },
      \"variables\": {},
      \"metadata\": {},
      \"created_at\": \"$TIMESTAMP\",
      \"updated_at\": \"$TIMESTAMP\"
    }
  },
  {
    \"op\": \"add\",
    \"entity\": {
      \"id\": \"ad010e00-0005-0005-0005-000000000005\",
      \"name\": \"S05 - Unknown Plugin\",
      \"version\": \"1.0.0\",
      \"description\": \"Middle node has unknown plugin ID\",
      \"workflow\": {
        \"nodes\": [
          {\"id\": \"nA\", \"type\": \"workflowNode\", \"position\": {\"x\": 200, \"y\": 200},
           \"data\": {\"elementType\": \"log\", \"nodeType\": \"plugin\", \"label\": \"Node A\", \"category\": \"system\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {\"message\": \"hello\"}}}},
          {\"id\": \"nB\", \"type\": \"workflowNode\", \"position\": {\"x\": 500, \"y\": 200},
           \"data\": {\"elementType\": \"does-not-exist\", \"nodeType\": \"plugin\", \"label\": \"Node B (Unknown)\", \"category\": \"custom\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {}}}},
          {\"id\": \"nC\", \"type\": \"workflowNode\", \"position\": {\"x\": 800, \"y\": 200},
           \"data\": {\"elementType\": \"log\", \"nodeType\": \"plugin\", \"label\": \"Node C\", \"category\": \"system\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {\"message\": \"world\"}}}}
        ],
        \"edges\": [
          {\"id\": \"e1\", \"source\": \"start-node\", \"target\": \"nA\"},
          {\"id\": \"e2\", \"source\": \"nA\", \"target\": \"nB\"},
          {\"id\": \"e3\", \"source\": \"nB\", \"target\": \"nC\"}
        ]
      },
      \"variables\": {},
      \"metadata\": {},
      \"created_at\": \"$TIMESTAMP\",
      \"updated_at\": \"$TIMESTAMP\"
    }
  },
  {
    \"op\": \"add\",
    \"entity\": {
      \"id\": \"ad010e00-0006-0006-0006-000000000006\",
      \"name\": \"S06 - Self Loop\",
      \"version\": \"1.0.0\",
      \"description\": \"Node B has a self-loop in a chain\",
      \"workflow\": {
        \"nodes\": [
          {\"id\": \"nA\", \"type\": \"workflowNode\", \"position\": {\"x\": 200, \"y\": 200},
           \"data\": {\"elementType\": \"log\", \"nodeType\": \"plugin\", \"label\": \"Node A\", \"category\": \"system\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {\"message\": \"hello\"}}}},
          {\"id\": \"nB\", \"type\": \"workflowNode\", \"position\": {\"x\": 500, \"y\": 200},
           \"data\": {\"elementType\": \"log\", \"nodeType\": \"plugin\", \"label\": \"Node B\", \"category\": \"system\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {\"message\": \"loop\"}}}},
          {\"id\": \"nC\", \"type\": \"workflowNode\", \"position\": {\"x\": 800, \"y\": 200},
           \"data\": {\"elementType\": \"log\", \"nodeType\": \"plugin\", \"label\": \"Node C\", \"category\": \"system\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {\"message\": \"world\"}}}}
        ],
        \"edges\": [
          {\"id\": \"e1\", \"source\": \"start-node\", \"target\": \"nA\"},
          {\"id\": \"e2\", \"source\": \"nA\", \"target\": \"nB\"},
          {\"id\": \"e-self\", \"source\": \"nB\", \"target\": \"nB\"},
          {\"id\": \"e3\", \"source\": \"nB\", \"target\": \"nC\"}
        ]
      },
      \"variables\": {},
      \"metadata\": {},
      \"created_at\": \"$TIMESTAMP\",
      \"updated_at\": \"$TIMESTAMP\"
    }
  },
  {
    \"op\": \"add\",
    \"entity\": {
      \"id\": \"ad010e00-0007-0007-0007-000000000007\",
      \"name\": \"S07 - Invalid Variables\",
      \"version\": \"1.0.0\",
      \"description\": \"Three INVALID_VARIABLE cases: unused, same-type rename, type-conflict delete\",
      \"workflow\": {
        \"nodes\": [
          {\"id\": \"n1\", \"type\": \"workflowNode\", \"position\": {\"x\": 300, \"y\": 200},
           \"data\": {\"elementType\": \"http-client\", \"nodeType\": \"plugin\", \"version\": \"1.0.0\",
                     \"label\": \"HTTP Request\",
                     \"config\": {
                       \"values\": {\"url\": \"http://example.com\", \"method\": \"GET\"},
                       \"outputBindings\": {\"status_code\": \"2-used-same\"}
                     }}},
          {\"id\": \"n2\", \"type\": \"workflowNode\", \"position\": {\"x\": 500, \"y\": 200},
           \"data\": {\"elementType\": \"log\", \"nodeType\": \"plugin\", \"version\": \"1.0.0\",
                     \"label\": \"Log Same 1\",
                     \"expressionFields\": [\"message\"],
                     \"config\": {\"values\": {\"message\": \"2-used-same\"}}}},
          {\"id\": \"n3\", \"type\": \"workflowNode\", \"position\": {\"x\": 700, \"y\": 200},
           \"data\": {\"elementType\": \"log\", \"nodeType\": \"plugin\", \"version\": \"1.0.0\",
                     \"label\": \"Log Same 2\",
                     \"expressionFields\": [\"message\"],
                     \"config\": {\"values\": {\"message\": \"2-used-same\"}}}},
          {\"id\": \"n4\", \"type\": \"workflowNode\", \"position\": {\"x\": 900, \"y\": 200},
           \"data\": {\"elementType\": \"delay\", \"nodeType\": \"control\", \"version\": \"1.0.0\",
                     \"label\": \"Delay\",
                     \"expressionFields\": [\"duration\"],
                     \"config\": {\"values\": {\"duration\": \"3-type-conflict\"}}}},
          {\"id\": \"n5\", \"type\": \"workflowNode\", \"position\": {\"x\": 1100, \"y\": 200},
           \"data\": {\"elementType\": \"log\", \"nodeType\": \"plugin\", \"version\": \"1.0.0\",
                     \"label\": \"Log Conflict\",
                     \"expressionFields\": [\"message\"],
                     \"config\": {\"values\": {\"message\": \"3-type-conflict\"}}}}
        ],
        \"edges\": [
          {\"id\": \"e1\", \"source\": \"start-node\", \"target\": \"n1\"},
          {\"id\": \"e2\", \"source\": \"n1\", \"target\": \"n2\"},
          {\"id\": \"e3\", \"source\": \"n2\", \"target\": \"n3\"},
          {\"id\": \"e4\", \"source\": \"n3\", \"target\": \"n4\"},
          {\"id\": \"e5\", \"source\": \"n4\", \"target\": \"n5\"}
        ]
      },
      \"variables\": {
        \"1-unused\": {\"type\": \"string\", \"value\": \"nobody uses me\"},
        \"2-used-same\": {\"type\": \"string\", \"value\": \"hello\"},
        \"3-type-conflict\": {\"type\": \"string\", \"value\": \"oops\"}
      },
      \"metadata\": {},
      \"created_at\": \"$TIMESTAMP\",
      \"updated_at\": \"$TIMESTAMP\"
    }
  },
  {
    \"op\": \"add\",
    \"entity\": {
      \"id\": \"ad010e00-0008-0008-0008-000000000008\",
      \"name\": \"S08 - Invalid Variable Type\",
      \"version\": \"1.0.0\",
      \"description\": \"Variable with bogus type\",
      \"workflow\": {\"nodes\": [], \"edges\": []},
      \"variables\": {
        \"good_name\": {\"type\": \"bogus_type\", \"value\": \"world\"}
      },
      \"metadata\": {},
      \"created_at\": \"$TIMESTAMP\",
      \"updated_at\": \"$TIMESTAMP\"
    }
  },
  {
    \"op\": \"add\",
    \"entity\": {
      \"id\": \"ad010e00-0009-0009-0009-000000000009\",
      \"name\": \"S09 - Fatal Missing Workflow\",
      \"version\": \"1.0.0\",
      \"description\": \"Missing workflow entirely\",
      \"variables\": {},
      \"metadata\": {},
      \"created_at\": \"$TIMESTAMP\",
      \"updated_at\": \"$TIMESTAMP\"
    }
  },
  {
    \"op\": \"add\",
    \"entity\": {
      \"id\": \"ad010e00-0010-0010-0010-000000000010\",
      \"name\": \"S10 - Fatal Invalid Nodes\",
      \"version\": \"1.0.0\",
      \"description\": \"Nodes is not an array\",
      \"workflow\": {\"nodes\": \"not-a-list\", \"edges\": []},
      \"variables\": {},
      \"metadata\": {},
      \"created_at\": \"$TIMESTAMP\",
      \"updated_at\": \"$TIMESTAMP\"
    }
  },
  {
    \"op\": \"add\",
    \"entity\": {
      \"id\": \"ad010e00-0011-0011-0011-000000000011\",
      \"name\": \"S11 - Disabled Node\",
      \"version\": \"1.0.0\",
      \"description\": \"Disabled node with missing params\",
      \"workflow\": {
        \"nodes\": [
          {\"id\": \"n1\", \"type\": \"workflowNode\", \"position\": {\"x\": 400, \"y\": 200},
           \"data\": {\"elementType\": \"http-client\", \"nodeType\": \"plugin\", \"label\": \"Disabled HTTP\", \"category\": \"network\", \"version\": \"1.0.0\",
                     \"disabled\": true,
                     \"config\": {\"values\": {}}}}
        ],
        \"edges\": [{\"id\": \"e1\", \"source\": \"start-node\", \"target\": \"n1\"}]
      },
      \"variables\": {},
      \"metadata\": {},
      \"created_at\": \"$TIMESTAMP\",
      \"updated_at\": \"$TIMESTAMP\"
    }
  },
  {
    \"op\": \"add\",
    \"entity\": {
      \"id\": \"ad010e00-0012-0012-0012-000000000012\",
      \"name\": \"S12 - Context Param Test\",
      \"version\": \"1.0.0\",
      \"description\": \"For testing invalid context param\",
      \"workflow\": {
        \"nodes\": [
          {\"id\": \"n1\", \"type\": \"workflowNode\", \"position\": {\"x\": 400, \"y\": 200},
           \"data\": {\"elementType\": \"http-client\", \"nodeType\": \"plugin\", \"label\": \"HTTP Call\", \"category\": \"network\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {\"url\": \"https://example.com\", \"method\": \"GET\"}}}}
        ],
        \"edges\": [{\"id\": \"e1\", \"source\": \"start-node\", \"target\": \"n1\"}]
      },
      \"variables\": {},
      \"metadata\": {},
      \"created_at\": \"$TIMESTAMP\",
      \"updated_at\": \"$TIMESTAMP\"
    }
  },
  {
    \"op\": \"add\",
    \"entity\": {
      \"id\": \"ad010e00-0013-0013-0013-000000000013\",
      \"name\": \"S13 - Save 422 Rejection\",
      \"version\": \"1.0.0\",
      \"description\": \"Missing required params for save\",
      \"workflow\": {
        \"nodes\": [
          {\"id\": \"n1\", \"type\": \"workflowNode\", \"position\": {\"x\": 400, \"y\": 200},
           \"data\": {\"elementType\": \"http-client\", \"nodeType\": \"plugin\", \"label\": \"HTTP Node\", \"category\": \"network\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {}}}}
        ],
        \"edges\": [{\"id\": \"e1\", \"source\": \"start-node\", \"target\": \"n1\"}]
      },
      \"variables\": {},
      \"metadata\": {},
      \"created_at\": \"$TIMESTAMP\",
      \"updated_at\": \"$TIMESTAMP\"
    }
  },
  {
    \"op\": \"add\",
    \"entity\": {
      \"id\": \"ad010e00-0014-0014-0014-000000000014\",
      \"name\": \"S14 - Multiple Edges\",
      \"version\": \"1.0.0\",
      \"description\": \"Node A has 2 outputs, node C has 2 inputs\",
      \"workflow\": {
        \"nodes\": [
          {\"id\": \"nA\", \"type\": \"workflowNode\", \"position\": {\"x\": 200, \"y\": 200},
           \"data\": {\"elementType\": \"log\", \"nodeType\": \"plugin\", \"label\": \"Node A\", \"category\": \"system\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {\"message\": \"start\"}}}},
          {\"id\": \"nB\", \"type\": \"workflowNode\", \"position\": {\"x\": 450, \"y\": 200},
           \"data\": {\"elementType\": \"log\", \"nodeType\": \"plugin\", \"label\": \"Node B\", \"category\": \"system\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {\"message\": \"middle\"}}}},
          {\"id\": \"nC\", \"type\": \"workflowNode\", \"position\": {\"x\": 700, \"y\": 200},
           \"data\": {\"elementType\": \"log\", \"nodeType\": \"plugin\", \"label\": \"Node C\", \"category\": \"system\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {\"message\": \"join\"}}}},
          {\"id\": \"nD\", \"type\": \"workflowNode\", \"position\": {\"x\": 950, \"y\": 200},
           \"data\": {\"elementType\": \"log\", \"nodeType\": \"plugin\", \"label\": \"Node D\", \"category\": \"system\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {\"message\": \"end\"}}}}
        ],
        \"edges\": [
          {\"id\": \"e1\", \"source\": \"start-node\", \"target\": \"nA\"},
          {\"id\": \"e2\", \"source\": \"nA\", \"target\": \"nB\"},
          {\"id\": \"e3\", \"source\": \"nB\", \"target\": \"nC\"},
          {\"id\": \"e4\", \"source\": \"nC\", \"target\": \"nD\"},
          {\"id\": \"e5\", \"source\": \"nA\", \"target\": \"nC\"}
        ]
      },
      \"variables\": {},
      \"metadata\": {},
      \"created_at\": \"$TIMESTAMP\",
      \"updated_at\": \"$TIMESTAMP\"
    }
  },
  {
    \"op\": \"add\",
    \"entity\": {
      \"id\": \"ad010e00-0015-0015-0015-000000000015\",
      \"name\": \"S15 - Self Loop + Multi Edge\",
      \"version\": \"1.0.0\",
      \"description\": \"B has self-loop AND duplicate outgoing edges\",
      \"workflow\": {
        \"nodes\": [
          {\"id\": \"nA\", \"type\": \"workflowNode\", \"position\": {\"x\": 200, \"y\": 200},
           \"data\": {\"elementType\": \"log\", \"nodeType\": \"plugin\", \"label\": \"Node A\", \"category\": \"system\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {\"message\": \"start\"}}}},
          {\"id\": \"nB\", \"type\": \"workflowNode\", \"position\": {\"x\": 450, \"y\": 200},
           \"data\": {\"elementType\": \"log\", \"nodeType\": \"plugin\", \"label\": \"Node B\", \"category\": \"system\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {\"message\": \"loop+multi\"}}}},
          {\"id\": \"nC\", \"type\": \"workflowNode\", \"position\": {\"x\": 700, \"y\": 200},
           \"data\": {\"elementType\": \"log\", \"nodeType\": \"plugin\", \"label\": \"Node C\", \"category\": \"system\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {\"message\": \"mid\"}}}},
          {\"id\": \"nD\", \"type\": \"workflowNode\", \"position\": {\"x\": 950, \"y\": 200},
           \"data\": {\"elementType\": \"log\", \"nodeType\": \"plugin\", \"label\": \"Node D\", \"category\": \"system\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {\"message\": \"end\"}}}}
        ],
        \"edges\": [
          {\"id\": \"e1\", \"source\": \"start-node\", \"target\": \"nA\"},
          {\"id\": \"e2\", \"source\": \"nA\", \"target\": \"nB\"},
          {\"id\": \"e3\", \"source\": \"nB\", \"target\": \"nC\"},
          {\"id\": \"e4\", \"source\": \"nC\", \"target\": \"nD\"},
          {\"id\": \"e-self\", \"source\": \"nB\", \"target\": \"nB\"},
          {\"id\": \"e5\", \"source\": \"nB\", \"target\": \"nD\"}
        ]
      },
      \"variables\": {},
      \"metadata\": {},
      \"created_at\": \"$TIMESTAMP\",
      \"updated_at\": \"$TIMESTAMP\"
    }
  },
  {
    \"op\": \"add\",
    \"entity\": {
      \"id\": \"ad010e00-0016-0016-0016-000000000016\",
      \"name\": \"S16 - Position Errors\",
      \"version\": \"1.0.0\",
      \"description\": \"Multiple nodes with missing or invalid positions\",
      \"workflow\": {
        \"nodes\": [
          {\"id\": \"nA\", \"type\": \"workflowNode\", \"position\": {\"x\": 300, \"y\": 200},
           \"data\": {\"elementType\": \"shell-script\", \"nodeType\": \"plugin\", \"label\": \"Good Node A\", \"category\": \"system\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {\"script\": \"echo ok\"}}}},
          {\"id\": \"nB\", \"type\": \"workflowNode\",
           \"data\": {\"elementType\": \"log\", \"nodeType\": \"plugin\", \"label\": \"Missing Position B\", \"category\": \"system\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {\"message\": \"no position at all\"}}}},
          {\"id\": \"nC\", \"type\": \"workflowNode\", \"position\": {\"x\": \"not-a-number\", \"y\": true},
           \"data\": {\"elementType\": \"http-client\", \"nodeType\": \"plugin\", \"label\": \"Invalid Position C\", \"category\": \"network\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {\"url\": \"https://example.com\", \"method\": \"GET\"}}}},
          {\"id\": \"nD\", \"type\": \"workflowNode\", \"position\": {\"x\": 800, \"y\": 200},
           \"data\": {\"elementType\": \"log\", \"nodeType\": \"plugin\", \"label\": \"Good Node D\", \"category\": \"system\", \"version\": \"1.0.0\",
                     \"config\": {\"values\": {\"message\": \"end\"}}}}
        ],
        \"edges\": [
          {\"id\": \"e1\", \"source\": \"start-node\", \"target\": \"nA\"},
          {\"id\": \"e2\", \"source\": \"nA\", \"target\": \"nB\"},
          {\"id\": \"e3\", \"source\": \"nB\", \"target\": \"nC\"},
          {\"id\": \"e4\", \"source\": \"nC\", \"target\": \"nD\"}
        ]
      },
      \"variables\": {},
      \"metadata\": {},
      \"created_at\": \"$TIMESTAMP\",
      \"updated_at\": \"$TIMESTAMP\"
    }
  }
]"

echo "V-VALIDATE-LOAD-01: Seeded 16 validation test entities"
