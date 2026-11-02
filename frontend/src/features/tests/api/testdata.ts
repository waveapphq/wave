/**
 * Test Data API client (REQ-3.4.3.2, REQ-5.2.4.12): a test's own files under
 * /tests/{testId}/testdata. Every path is relative to the test's folder ("" is
 * the folder itself).
 */

import { apiClient, getApiBaseUrl } from "@/lib/api";
import { encodePathSegments, postUpload } from "@/lib/api/upload";
import { downloadFromUrl } from "@/lib/download-file";
import { splitReference } from "@/lib/file-references";
import type {
  TestDataListing,
  TestDataUploadItem,
  TestDataUploadState,
} from "./types";

const UPLOAD_FALLBACK = "Upload failed";
const ZIP_STEM = "testdata";

export interface UploadOptions {
  /** Bytes of the file that have left the machine, and its total size. */
  onProgress?: (loaded: number, total: number) => void;
  /** Cancels the upload; the server deletes what it had written. */
  signal?: AbortSignal;
  /** The row this upload owns, which every session watching sees under this id. */
  uploadId: string;
  /** This tab, so the server knows who may cancel it. */
  session: string;
  /** The notice being retried; it lets this upload displace its own leftover. */
  retryOf?: string;
}

/** Why a file the client never sent did not land, recorded as a notice like any other. */
export interface InterruptionReport {
  path: string;
  name: string;
  reason: string;
  replace: boolean;
}

function testdataPath(testId: string, path: string): string {
  return `/tests/${testId}/testdata/${encodePathSegments(path)}`;
}

function zipFallbackName(path: string): string {
  return `${[ZIP_STEM, splitReference(path).name].filter(Boolean).join("-")}.zip`;
}

export const testdataApi = {
  async list(testId: string): Promise<TestDataListing> {
    const response = await apiClient.get<TestDataListing>(
      `/tests/${testId}/testdata`,
      { rawResponse: true },
    );
    return response.data;
  },

  upload(
    testId: string,
    folder: string,
    file: File,
    replace: boolean,
    options: UploadOptions,
  ): Promise<TestDataUploadItem> {
    // The server reads every field before the first file byte, so they go first.
    const form = new FormData();
    form.append("path", folder);
    form.append("replace", String(replace));
    form.append("upload_id", options.uploadId);
    form.append("session", options.session);
    form.append("size", String(file.size));
    form.append("retry_of", options.retryOf ?? "");
    form.append("files", file);
    return postUpload<TestDataUploadItem>(
      `/tests/${testId}/testdata/upload`,
      form,
      UPLOAD_FALLBACK,
      {
        rawResponse: true,
        onProgress: options.onProgress,
        signal: options.signal,
      },
    );
  },

  async uploadState(testId: string): Promise<TestDataUploadState> {
    const response = await apiClient.get<TestDataUploadState>(
      `/tests/${testId}/testdata/uploads`,
      { rawResponse: true },
    );
    return response.data;
  },

  async cancelUpload(
    testId: string,
    uploadId: string,
    session: string,
  ): Promise<void> {
    await apiClient.post(
      `/tests/${testId}/testdata/uploads/${uploadId}/cancel`,
      { session },
      { rawResponse: true },
    );
  },

  async dismissUpload(testId: string, uploadId: string): Promise<void> {
    await apiClient.post(
      `/tests/${testId}/testdata/uploads/${uploadId}/dismiss`,
      {},
      { rawResponse: true },
    );
  },

  async reportInterruption(
    testId: string,
    uploadId: string,
    report: InterruptionReport,
  ): Promise<void> {
    await apiClient.post(
      `/tests/${testId}/testdata/uploads/${uploadId}/interrupt`,
      report,
      { rawResponse: true },
    );
  },

  async checkSpace(
    testId: string,
    bytes: number,
    name: string,
  ): Promise<void> {
    const query = `bytes=${bytes}&name=${encodeURIComponent(name)}`;
    await apiClient.get<{ ok: boolean }>(
      `/tests/${testId}/testdata/space?${query}`,
      { rawResponse: true },
    );
  },

  async createFolder(testId: string, path: string): Promise<{ path: string }> {
    const response = await apiClient.post<{ path: string }>(
      `/tests/${testId}/testdata/folders`,
      {
        path,
      },
      { rawResponse: true },
    );
    return response.data;
  },

  async rename(
    testId: string,
    path: string,
    newPath: string,
  ): Promise<{ path: string }> {
    const response = await apiClient.patch<{ path: string }>(
      testdataPath(testId, path),
      {
        path: newPath,
      },
      { rawResponse: true },
    );
    return response.data;
  },

  async remove(testId: string, path: string): Promise<void> {
    await apiClient.delete(testdataPath(testId, path));
  },

  contentUrl(testId: string, path: string): string {
    return `${getApiBaseUrl()}/tests/${testId}/testdata/content/${encodePathSegments(path)}`;
  },

  zipUrl(testId: string, path: string): string {
    return `${getApiBaseUrl()}/tests/${testId}/testdata/zip?path=${encodeURIComponent(path)}`;
  },

  download(testId: string, path: string): Promise<void> {
    return downloadFromUrl(
      testdataApi.contentUrl(testId, path),
      splitReference(path).name,
    );
  },

  downloadZip(testId: string, path: string): Promise<void> {
    return downloadFromUrl(
      testdataApi.zipUrl(testId, path),
      zipFallbackName(path),
    );
  },
};
