/**
 * File I/O Plugin Parameters
 *
 * One flat form driven by Operation (FIO-1). Path and Source are paired rows -
 * one wire name, one flavor per operation - so the info badge, the placeholder
 * and the picker mode always describe the operation on screen (FIO-2, TDATA-10).
 */

import { output, param, type InputParam, type OutputParam } from "../types";
import {
  ifExistsInput,
  ignoreMissingInput,
  includeSubfoldersInput,
} from "./_file-shared";

const READ = { field: "operation", values: ["read"] };
const WRITE = { field: "operation", values: ["write"] };
const COPY = { field: "operation", values: ["copy"] };
const MOVE = { field: "operation", values: ["move"] };
const DELETE = { field: "operation", values: ["delete"] };
const STATS = { field: "operation", values: ["stats"] };
const LIST = { field: "operation", values: ["list"] };
const CREATE_FOLDER = { field: "operation", values: ["create_folder"] };
const COPY_OR_MOVE = { field: "operation", values: ["copy", "move"] };
const STATS_OR_LIST = { field: "operation", values: ["stats", "list"] };

const INDIVIDUAL = { field: "output_format", values: ["individual"] };
const MAP = { field: "output_format", values: ["map"] };
const TABLE = { field: "output_format", values: ["table"] };
const SIZE_TICKED = { field: "size", values: ["true"] };
const CHECKSUM_CHOSEN = {
  field: "checksum",
  values: ["md5", "sha1", "sha256", "sha512"],
};

const PATH_READABLE = "artifact://…, testdata://…, or /abs/path";
const PATH_WRITABLE = "artifact://…, or /abs/path";

const OPERATION_DESCRIPTION =
  "What to do. Read returns a file's text. Write creates or changes a file. Copy and Move take a " +
  "source and a destination. Delete removes a file or folder. Stats reports whether a path is there " +
  "and what it is. List returns a folder's entries as a table. Create folder makes a folder and " +
  "its missing parents.";

interface PathFlavor {
  showWhen: { field: string; values: string[] };
  description: string;
  placeholder: string;
  fileReference: NonNullable<InputParam["fileReference"]>;
  fileReferenceArtifactsOnly?: boolean;
}

/** A path-like row: required while on screen, plain text, a host path in a
 *  Remote body, and the Browse picker in the flavor's mode. */
function pathInput(
  name: string,
  label: string,
  flavor: PathFlavor,
): InputParam {
  return param(name, label, "string", false, flavor.description, {
    showWhen: flavor.showWhen,
    requiredWhen: flavor.showWhen,
    placeholder: flavor.placeholder,
    allowedFormats: ["plain"],
    fileReference: flavor.fileReference,
    ...(flavor.fileReferenceArtifactsOnly
      ? { fileReferenceArtifactsOnly: true }
      : {}),
  });
}

const PATH_FLAVORS: PathFlavor[] = [
  {
    showWhen: READ,
    description:
      "File to read as UTF-8 text. Pick a Test Data or Artifact file with Browse, or type artifact://, testdata://, or an absolute or relative path where the block runs.",
    placeholder: PATH_READABLE,
    fileReference: "file",
  },
  {
    showWhen: WRITE,
    description:
      "File to write. artifact:// or an absolute or relative path where the block runs; missing folders are created. testdata:// is read-only.",
    placeholder: PATH_WRITABLE,
    fileReference: "save-as",
  },
  {
    showWhen: DELETE,
    description:
      "File or folder to delete. A folder is removed with everything inside it. testdata:// is read-only.",
    placeholder: PATH_WRITABLE,
    fileReference: "file-or-folder",
  },
  {
    showWhen: STATS,
    description:
      "File or folder to report on. A missing path is not an error: Exists is false.",
    placeholder: PATH_READABLE,
    fileReference: "file-or-folder",
  },
  {
    showWhen: LIST,
    description: "Folder to list.",
    placeholder: PATH_READABLE,
    fileReference: "folder",
  },
  {
    showWhen: CREATE_FOLDER,
    description:
      "Folder to create, including its name. Missing parents are created; an existing folder is not an error. testdata:// is read-only.",
    placeholder: PATH_WRITABLE,
    fileReference: "save-as",
  },
];

export const inputs: InputParam[] = [
  param("operation", "Operation", "string", true, OPERATION_DESCRIPTION, {
    enumValues: [
      "read",
      "write",
      "copy",
      "move",
      "delete",
      "stats",
      "list",
      "create_folder",
    ],
    enumLabels: {
      read: "Read",
      write: "Write",
      copy: "Copy",
      move: "Move",
      delete: "Delete",
      stats: "Stats",
      list: "List",
      create_folder: "Create folder",
    },
    defaultValue: "read",
    noExpression: true,
  }),
  ...PATH_FLAVORS.map((flavor) => pathInput("path", "Path", flavor)),
  pathInput("source", "Source", {
    showWhen: COPY,
    description:
      "File or folder to copy. Pick a Test Data or Artifact file or folder with Browse, or type a path.",
    placeholder: PATH_READABLE,
    fileReference: "file-or-folder",
  }),
  pathInput("source", "Source", {
    showWhen: MOVE,
    description:
      "File or folder to move. artifact:// or an absolute or relative path; testdata:// is read-only.",
    placeholder: PATH_WRITABLE,
    fileReference: "file-or-folder",
    fileReferenceArtifactsOnly: true,
  }),
  pathInput("destination", "Destination", {
    showWhen: COPY_OR_MOVE,
    description:
      "The full target path, including the new name. artifact:// or an absolute or relative path; missing folders are created. testdata:// is read-only.",
    placeholder: PATH_WRITABLE,
    fileReference: "save-as",
  }),
  param("content", "Content", "string", false, "Text to write, UTF-8.", {
    showWhen: WRITE,
    requiredWhen: WRITE,
  }),
  ifExistsInput("What happens when the file is already there.", WRITE, {
    append: true,
  }),
  ifExistsInput(
    "What happens when the destination is already there. Replacing a folder merges: files inside are replaced, others are kept.",
    COPY_OR_MOVE,
  ),
  ignoreMissingInput("Succeed when there is nothing to delete.", DELETE),
  param(
    "pattern",
    "RegEx Pattern",
    "string",
    false,
    "Python regular expression matched against each entry name. Empty lists everything.",
    {
      defaultValue: "",
      placeholder: String.raw`^report-.*\.json$`,
      showWhen: LIST,
    },
  ),
  includeSubfoldersInput("List entries at every depth below the folder.", LIST),
  param(
    "size",
    "Size",
    "boolean",
    false,
    "Include the size in bytes. A folder's size is everything inside it, at every depth.",
    {
      defaultValue: false,
      showWhen: STATS_OR_LIST,
    },
  ),
  param(
    "checksum",
    "Checksum",
    "string",
    false,
    "Digest of the file's bytes. Empty for a folder.",
    {
      enumValues: ["none", "md5", "sha1", "sha256", "sha512"],
      enumLabels: {
        none: "None",
        md5: "MD5",
        sha1: "SHA-1",
        sha256: "SHA-256",
        sha512: "SHA-512",
      },
      defaultValue: "none",
      noExpression: true,
      showWhen: STATS,
    },
  ),
  param(
    "output_format",
    "Output format",
    "string",
    false,
    "Individual outputs, one map, or a one-row table.",
    {
      enumValues: ["individual", "map", "table"],
      enumLabels: { individual: "Individual", map: "Map", table: "Table" },
      defaultValue: "individual",
      noExpression: true,
      showWhen: STATS,
    },
  ),
];

export const outputs: OutputParam[] = [
  output("content", "Content", "string", "The file's text.", {
    showWhen: READ,
  }),
  output("exists", "Exists", "boolean", "True when the path is there.", {
    showWhenAll: [STATS, INDIVIDUAL],
  }),
  output(
    "type",
    "Type",
    "string",
    "file, folder, or empty when the path is missing.",
    {
      showWhenAll: [STATS, INDIVIDUAL],
    },
  ),
  output(
    "modified",
    "Modified",
    "string",
    "Last modified, ISO-8601 UTC; empty when the path is missing.",
    {
      showWhenAll: [STATS, INDIVIDUAL],
    },
  ),
  output("size", "Size", "integer", "Size in bytes.", {
    showWhenAll: [STATS, INDIVIDUAL, SIZE_TICKED],
  }),
  output(
    "checksum",
    "Checksum",
    "string",
    "Hex digest; empty for a folder or a missing path.",
    {
      showWhenAll: [STATS, INDIVIDUAL, CHECKSUM_CHOSEN],
    },
  ),
  output(
    "stats",
    "Stats",
    "map",
    "exists, type, modified, and size or checksum when chosen.",
    {
      showWhenAll: [STATS, MAP],
    },
  ),
  output("stats", "Stats", "table", "One row with the same columns.", {
    showWhenAll: [STATS, TABLE],
  }),
  output(
    "entries",
    "Entries",
    "table",
    "One row per entry: name, path, type, modified, and size when ticked.",
    {
      showWhen: LIST,
    },
  ),
  output("count", "Count", "integer", "Number of entries.", { showWhen: LIST }),
];
