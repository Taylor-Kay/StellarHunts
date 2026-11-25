"use client";

import { useState, useCallback, useRef } from "react";

/**
 * Status values for a data export request lifecycle.
 * @typedef {'idle'|'pending'|'processing'|'complete'|'error'} ExportStatus
 */

/**
 * @typedef {Object} ExportData
 * @property {string} schemaVersion
 * @property {string} exportedAt
 * @property {string} userId
 * @property {string} username
 * @property {PuzzleSolvedExport[]} puzzlesSolved
 * @property {AchievementExport[]} achievements
 * @property {NftExport[]} nfts
 * @property {{ currentStreak: number; longestStreak: number; lastActivityDate?: string }} streaks
 * @property {{ walletAddress: string; verifiedAt: string; network?: string }=} onChainVerification
 * @property {number=} totalPoints
 * @property {number=} rank
 */

/**
 * @typedef {Object} PuzzleSolvedExport
 * @property {string} puzzleId
 * @property {string} title
 * @property {string} solvedAt
 * @property {number} attemptCount
 * @property {number=} score
 * @property {string=} category
 * @property {string=} difficulty
 * @property {string=} onChainTxHash
 */

/**
 * @typedef {Object} AchievementExport
 * @property {string} id
 * @property {string} name
 * @property {string} earnedAt
 * @property {string=} description
 * @property {string=} badgeImageUrl
 */

/**
 * @typedef {Object} NftExport
 * @property {string} tokenId
 * @property {string} contractAddress
 * @property {string} name
 * @property {string} claimedAt
 * @property {string=} onChainTxHash
 * @property {boolean=} onChainVerified
 */

/**
 * @typedef {Object} UseDataExportOptions
 * @property {string} [exportUrl='/api/users/me/progress/export'] - Backend endpoint for the export
 * @property {number} [pollIntervalMs=10000]                      - How often to poll for completion (ms)
 * @property {number} [maxPollAttempts=30]                        - Maximum polling rounds before timing out
 * @property {() => Promise<string>} [getAuthToken]               - Async fn that resolves to Bearer token
 */

/**
 * @typedef {Object} UseDataExportReturn
 * @property {'idle'|'pending'|'processing'|'complete'|'error'} status - Current export lifecycle status
 * @property {string|null} downloadUrl   - Object URL to download the export; set when status is 'complete'
 * @property {ExportData|null} exportData - Parsed export data; set when status is 'complete'
 * @property {string|null} error         - Human-readable error message; set when status is 'error'
 * @property {() => Promise<void>} requestExport - Call to initiate an export request
 * @property {() => void} reset          - Resets all state back to 'idle'
 */

/**
 * useDataExport
 *
 * Initiates a user data export request, polls the backend for completion every 10 s
 * (configurable), and exposes a download URL and the parsed export object when done.
 *
 * The download URL is a browser-side `Blob` object URL created from the fetched
 * JSON payload so the user can trigger a file download without a second round-trip.
 * The URL is cached: calling `requestExport` again while status is 'complete' returns
 * the cached URL immediately.
 *
 * @param {UseDataExportOptions} [options]
 * @returns {UseDataExportReturn}
 *
 * @example
 * const { status, requestExport, downloadUrl, error } = useDataExport();
 *
 * return (
 *   <>
 *     <button onClick={requestExport} disabled={status === 'pending' || status === 'processing'}>
 *       {status === 'processing' ? 'Exporting…' : 'Export My Data'}
 *     </button>
 *     {status === 'complete' && <a href={downloadUrl} download="progress.json">Download</a>}
 *     {status === 'error' && <p>{error}</p>}
 *   </>
 * );
 */
export function useDataExport({
  exportUrl = "/api/users/me/progress/export",
  pollIntervalMs = 10_000,
  maxPollAttempts = 30,
  getAuthToken,
} = {}) {
  const [status, setStatus] = useState(/** @type {'idle'|'pending'|'processing'|'complete'|'error'} */ ("idle"));
  const [downloadUrl, setDownloadUrl] = useState(/** @type {string|null} */ (null));
  const [exportData, setExportData] = useState(/** @type {ExportData|null} */ (null));
  const [error, setError] = useState(/** @type {string|null} */ (null));

  // Keep a ref to avoid stale closures in the polling loop
  const pollTimerRef = useRef(/** @type {ReturnType<typeof setTimeout>|null} */ (null));
  const pollAttemptsRef = useRef(0);
  // Cached download URL — avoids recreating Object URLs on re-render
  const cachedDownloadUrlRef = useRef(/** @type {string|null} */ (null));

  /**
   * Build the Authorization header when a token provider is configured.
   * @returns {Promise<Record<string, string>>}
   */
  const buildHeaders = useCallback(async () => {
    /** @type {Record<string, string>} */
    const headers = { Accept: "application/json" };
    if (typeof getAuthToken === "function") {
      const token = await getAuthToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }
    return headers;
  }, [getAuthToken]);

  /**
   * Fetch the export endpoint, parse the JSON blob, generate an Object URL,
   * and transition state to 'complete'.
   * @returns {Promise<boolean>} true when the export completed successfully
   */
  const fetchExport = useCallback(
    async () => {
      const headers = await buildHeaders();

      const response = await fetch(exportUrl, { headers });

      if (response.status === 202) {
        // Backend is still processing — stay in 'processing' state
        return false;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const message =
          response.status === 429
            ? "Export rate limit exceeded. Please wait before trying again."
            : response.status === 401
            ? "Authentication required. Please sign in and try again."
            : `Export failed (HTTP ${response.status}): ${body || response.statusText}`;
        throw new Error(message);
      }

      const json = /** @type {ExportData} */ (await response.json());

      // Reuse any existing Object URL to avoid memory leaks
      if (cachedDownloadUrlRef.current) {
        URL.revokeObjectURL(cachedDownloadUrlRef.current);
      }

      const blob = new Blob([JSON.stringify(json, null, 2)], {
        type: "application/json",
      });
      const objectUrl = URL.createObjectURL(blob);
      cachedDownloadUrlRef.current = objectUrl;

      setExportData(json);
      setDownloadUrl(objectUrl);
      setStatus("complete");
      return true;
    },
    [exportUrl, buildHeaders],
  );

  /**
   * Poll the export endpoint every `pollIntervalMs` milliseconds until
   * the export is ready or the maximum number of attempts is reached.
   */
  const startPolling = useCallback(() => {
    pollAttemptsRef.current = 0;

    const poll = async () => {
      if (pollAttemptsRef.current >= maxPollAttempts) {
        setStatus("error");
        setError("Export timed out. Please try again later.");
        return;
      }
      pollAttemptsRef.current++;

      try {
        const done = await fetchExport();
        if (!done) {
          // Schedule next poll
          pollTimerRef.current = setTimeout(poll, pollIntervalMs);
        }
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    pollTimerRef.current = setTimeout(poll, pollIntervalMs);
  }, [fetchExport, maxPollAttempts, pollIntervalMs]);

  /**
   * Initiate a new data export request.
   * - If status is already 'complete', returns the cached download URL immediately.
   * - If status is 'pending' or 'processing', the call is ignored.
   */
  const requestExport = useCallback(async () => {
    if (status === "pending" || status === "processing") return;

    // Return cached result without a new network call
    if (status === "complete" && cachedDownloadUrlRef.current) return;

    setStatus("pending");
    setError(null);

    try {
      const done = await fetchExport();
      if (done) return; // completed immediately (no polling needed)

      // Server returned 202 or is still building the export
      setStatus("processing");
      startPolling();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [status, fetchExport, startPolling]);

  /**
   * Reset all hook state back to idle and free the cached Object URL.
   */
  const reset = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (cachedDownloadUrlRef.current) {
      URL.revokeObjectURL(cachedDownloadUrlRef.current);
      cachedDownloadUrlRef.current = null;
    }
    setStatus("idle");
    setDownloadUrl(null);
    setExportData(null);
    setError(null);
    pollAttemptsRef.current = 0;
  }, []);

  return {
    /** @type {'idle'|'pending'|'processing'|'complete'|'error'} */
    status,
    /** @type {string|null} */
    downloadUrl,
    /** @type {ExportData|null} */
    exportData,
    /** @type {string|null} */
    error,
    requestExport,
    reset,
  };
}

export default useDataExport;
