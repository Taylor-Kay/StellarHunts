import { renderHook, act, waitFor } from "@testing-library/react";
import { useDataExport } from "./useDataExport";

// Use fake timers so polling doesn't require real time in tests
jest.useFakeTimers();

const mockExportPayload = {
  schemaVersion: "1.0",
  exportedAt: "2024-01-01T00:00:00.000Z",
  userId: "user-123",
  username: "alice",
  puzzlesSolved: [{ puzzleId: "p1", title: "Intro", solvedAt: "2024-01-01T00:00:00Z", attemptCount: 1, score: 100 }],
  achievements: [{ id: "ach-1", name: "First Solve", earnedAt: "2024-01-01T00:00:00Z" }],
  nfts: [],
  streaks: { currentStreak: 5, longestStreak: 10 },
  totalPoints: 500,
};

describe("useDataExport", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    global.URL.createObjectURL = jest.fn(() => "blob:test-url");
    global.URL.revokeObjectURL = jest.fn();
    jest.clearAllTimers();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("starts in idle state", () => {
    const { result } = renderHook(() => useDataExport());
    expect(result.current.status).toBe("idle");
    expect(result.current.downloadUrl).toBeNull();
    expect(result.current.exportData).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("transitions to complete and provides download URL when export is ready immediately", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockExportPayload,
    });

    const { result } = renderHook(() => useDataExport());

    await act(async () => {
      await result.current.requestExport();
    });

    expect(result.current.status).toBe("complete");
    expect(result.current.downloadUrl).toBe("blob:test-url");
    expect(result.current.exportData).toEqual(mockExportPayload);
    expect(result.current.error).toBeNull();
  });

  it("transitions to processing when server returns 202 and polls every 10 s", async () => {
    // First call → 202 (processing)
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 202, json: async () => ({}) })
      // Second call after 10 s → 200 (complete)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => mockExportPayload });

    const { result } = renderHook(() => useDataExport({ pollIntervalMs: 10_000 }));

    await act(async () => {
      await result.current.requestExport();
    });

    expect(result.current.status).toBe("processing");

    // Advance timer by 10 s to trigger the first poll
    await act(async () => {
      jest.advanceTimersByTime(10_000);
      await Promise.resolve(); // flush microtasks
    });

    await waitFor(() => expect(result.current.status).toBe("complete"));
    expect(result.current.downloadUrl).toBe("blob:test-url");
  });

  it("sets error state on HTTP 401", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    });

    const { result } = renderHook(() => useDataExport());

    await act(async () => {
      await result.current.requestExport();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toMatch(/Authentication required/i);
  });

  it("sets error state on HTTP 429 (rate limit)", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "",
    });

    const { result } = renderHook(() => useDataExport());

    await act(async () => {
      await result.current.requestExport();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toMatch(/rate limit/i);
  });

  it("caches the download URL and does not re-fetch when status is complete", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockExportPayload,
    });

    const { result } = renderHook(() => useDataExport());

    await act(async () => {
      await result.current.requestExport();
    });

    expect(result.current.status).toBe("complete");
    const firstUrl = result.current.downloadUrl;

    // Second call — should NOT trigger another fetch
    await act(async () => {
      await result.current.requestExport();
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.current.downloadUrl).toBe(firstUrl);
  });

  it("times out after maxPollAttempts polls", async () => {
    // Always return 202
    global.fetch.mockResolvedValue({ ok: false, status: 202, json: async () => ({}) });

    const { result } = renderHook(() =>
      useDataExport({ pollIntervalMs: 1_000, maxPollAttempts: 3 }),
    );

    await act(async () => {
      await result.current.requestExport();
    });

    expect(result.current.status).toBe("processing");

    // Trigger 3 poll rounds
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        jest.advanceTimersByTime(1_000);
        await Promise.resolve();
      });
    }

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toMatch(/timed out/i);
  });

  it("reset() brings the hook back to idle", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockExportPayload,
    });

    const { result } = renderHook(() => useDataExport());

    await act(async () => {
      await result.current.requestExport();
    });

    expect(result.current.status).toBe("complete");

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.downloadUrl).toBeNull();
    expect(result.current.exportData).toBeNull();
    expect(global.URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("forwards Authorization header when getAuthToken is provided", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockExportPayload,
    });

    const { result } = renderHook(() =>
      useDataExport({ getAuthToken: async () => "my-token-123" }),
    );

    await act(async () => {
      await result.current.requestExport();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer my-token-123",
        }),
      }),
    );
  });
});
