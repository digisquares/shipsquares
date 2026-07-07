// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { type ApiResult } from "./api";
import { describeError, useResource } from "./use-resource";

const ok = <T>(data: T): ApiResult<T> => ({ ok: true, status: 200, data });
const fail = <T>(status: number): ApiResult<T> => ({ ok: false, status, data: null as T });

describe("describeError", () => {
  it("maps transport + status codes to human messages", () => {
    expect(describeError(0)).toMatch(/reach the server/i);
    expect(describeError(403)).toMatch(/access/i);
    expect(describeError(404)).toMatch(/no longer exists/i);
    expect(describeError(503)).toMatch(/503/);
    expect(describeError(422)).toMatch(/422/);
  });
});

describe("useResource", () => {
  it("starts loading, then resolves to data with no error", async () => {
    const { result } = renderHook(() => useResource(() => Promise.resolve(ok({ n: 1 }))));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ n: 1 });
    expect(result.current.error).toBeNull();
  });

  it("sets error (not data) on a failed load", async () => {
    const { result } = renderHook(() =>
      useResource<{ n: number }>(() => Promise.resolve(fail<{ n: number }>(500))),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/500/);
    expect(result.current.data).toBeNull();
  });

  it("reload re-runs the fetch and recovers from an error", async () => {
    let call = 0;
    const fetcher = vi.fn(
      (): Promise<ApiResult<{ n: number }>> =>
        Promise.resolve(call++ === 0 ? fail<{ n: number }>(500) : ok({ n: 2 })),
    );
    const { result } = renderHook(() => useResource(fetcher));
    await waitFor(() => expect(result.current.error).toMatch(/500/));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
    expect(result.current.error).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
