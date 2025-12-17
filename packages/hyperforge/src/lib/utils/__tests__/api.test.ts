/**
 * API Utilities Tests
 *
 * Tests for API request helpers, error handling, and response utilities.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import {
  ApiError,
  apiFetch,
  fetchJson,
  postJson,
  putJson,
  deleteRequest,
  retryFetch,
  apiResponse,
  apiErrorResponse,
  getErrorMessage,
  isAbortError,
} from "@/lib/utils/api";

// Store original fetch
const originalFetch = global.fetch;

describe("API Utilities", () => {
  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("ApiError", () => {
    it("creates an error with message and default status code", () => {
      const error = new ApiError("Test error");

      expect(error.message).toBe("Test error");
      expect(error.statusCode).toBe(500);
      expect(error.name).toBe("ApiError");
      expect(error.details).toBeUndefined();
    });

    it("creates an error with custom status code", () => {
      const error = new ApiError("Not found", 404);

      expect(error.message).toBe("Not found");
      expect(error.statusCode).toBe(404);
    });

    it("creates an error with details object", () => {
      const details = { field: "email", reason: "invalid format" };
      const error = new ApiError("Validation failed", 400, details);

      expect(error.statusCode).toBe(400);
      expect(error.details).toEqual(details);
    });

    it("creates an error with string details", () => {
      const error = new ApiError("Error", 500, "Additional info");

      expect(error.details).toBe("Additional info");
    });

    it("is an instance of Error", () => {
      const error = new ApiError("Test");

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ApiError);
    });
  });

  describe("apiFetch", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("makes a simple fetch request", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ success: true }), { status: 200 }),
        );
      vi.stubGlobal("fetch", mockFetch);

      const response = await apiFetch("https://api.example.com/data");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/data",
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
      expect(response.status).toBe(200);
    });

    it("constructs URL with baseUrl", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 200 }));
      vi.stubGlobal("fetch", mockFetch);

      await apiFetch("/users", { baseUrl: "https://api.example.com" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/users",
        expect.any(Object),
      );
    });

    it("passes custom headers", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 200 }));
      vi.stubGlobal("fetch", mockFetch);

      await apiFetch("https://api.example.com/data", {
        headers: { Authorization: "Bearer token123" },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/data",
        expect.objectContaining({
          headers: { Authorization: "Bearer token123" },
        }),
      );
    });

    it("passes HTTP method", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 200 }));
      vi.stubGlobal("fetch", mockFetch);

      await apiFetch("https://api.example.com/data", { method: "POST" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/data",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    it("passes request body", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 200 }));
      vi.stubGlobal("fetch", mockFetch);

      const body = JSON.stringify({ name: "test" });
      await apiFetch("https://api.example.com/data", {
        method: "POST",
        body,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/data",
        expect.objectContaining({
          method: "POST",
          body,
        }),
      );
    });

    it("uses custom signal when provided", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 200 }));
      vi.stubGlobal("fetch", mockFetch);

      const controller = new AbortController();
      await apiFetch("https://api.example.com/data", {
        signal: controller.signal,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/data",
        expect.objectContaining({
          signal: controller.signal,
        }),
      );
    });

    it("creates abort controller for timeout", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 200 }));
      vi.stubGlobal("fetch", mockFetch);

      await apiFetch("https://api.example.com/data", { timeoutMs: 5000 });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/data",
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });
  });

  describe("fetchJson", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("fetches and parses JSON response", async () => {
      const mockData = { id: 1, name: "Test" };
      const mockFetch = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify(mockData), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", mockFetch);

      const result = await fetchJson<{ id: number; name: string }>(
        "https://api.example.com/data",
      );

      expect(result).toEqual(mockData);
    });

    it("sets Content-Type header to application/json", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", mockFetch);

      await fetchJson("https://api.example.com/data");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/data",
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        }),
      );
    });

    it("merges custom headers with Content-Type", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", mockFetch);

      await fetchJson("https://api.example.com/data", {
        headers: { Authorization: "Bearer token" },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/data",
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Bearer token",
          }),
        }),
      );
    });

    it("throws ApiError on non-ok response", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          statusText: "Not Found",
        }),
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        fetchJson("https://api.example.com/missing"),
      ).rejects.toThrow(ApiError);
    });

    it("extracts error message from response body", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Resource not found" }), {
          status: 404,
          statusText: "Not Found",
        }),
      );
      vi.stubGlobal("fetch", mockFetch);

      try {
        await fetchJson("https://api.example.com/missing");
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        const error = e as ApiError;
        expect(error.statusCode).toBe(404);
        expect(error.message).toBe("Resource not found");
      }
    });

    it("uses status text when error body has no error field", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Something went wrong" }), {
          status: 500,
          statusText: "Internal Server Error",
        }),
      );
      vi.stubGlobal("fetch", mockFetch);

      try {
        await fetchJson("https://api.example.com/data");
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        const error = e as ApiError;
        expect(error.message).toBe(
          "API request failed: 500 Internal Server Error",
        );
      }
    });

    it("handles non-JSON error responses", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(
        new Response("Server error", {
          status: 500,
          statusText: "Internal Server Error",
        }),
      );
      vi.stubGlobal("fetch", mockFetch);

      try {
        await fetchJson("https://api.example.com/data");
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        const error = e as ApiError;
        expect(error.statusCode).toBe(500);
        expect(error.message).toBe(
          "API request failed: 500 Internal Server Error",
        );
      }
    });

    it("passes through fetch options", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", mockFetch);

      await fetchJson("/data", {
        baseUrl: "https://base.com",
        timeoutMs: 5000,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://base.com/data",
        expect.any(Object),
      );
    });
  });

  describe("postJson", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("sends POST request with JSON body", async () => {
      const requestData = { name: "Test", value: 123 };
      const responseData = { id: 1, ...requestData };

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(responseData), { status: 201 }),
        );
      vi.stubGlobal("fetch", mockFetch);

      const result = await postJson<typeof responseData>(
        "https://api.example.com/items",
        requestData,
      );

      expect(result).toEqual(responseData);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/items",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(requestData),
        }),
      );
    });

    it("handles arrays as body", async () => {
      const requestData = [1, 2, 3];

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ count: 3 }), { status: 200 }),
        );
      vi.stubGlobal("fetch", mockFetch);

      await postJson("https://api.example.com/batch", requestData);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/batch",
        expect.objectContaining({
          body: JSON.stringify(requestData),
        }),
      );
    });

    it("handles primitive values as body", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ result: "ok" }), { status: 200 }),
        );
      vi.stubGlobal("fetch", mockFetch);

      await postJson("https://api.example.com/data", "simple string");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/data",
        expect.objectContaining({
          body: JSON.stringify("simple string"),
        }),
      );
    });

    it("passes additional options", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", mockFetch);

      await postJson(
        "https://api.example.com/data",
        { key: "value" },
        { headers: { "X-Custom": "header" } },
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/data",
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Custom": "header",
          }),
        }),
      );
    });
  });

  describe("putJson", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("sends PUT request with JSON body", async () => {
      const requestData = { name: "Updated" };
      const responseData = { id: 1, name: "Updated" };

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(responseData), { status: 200 }),
        );
      vi.stubGlobal("fetch", mockFetch);

      const result = await putJson<typeof responseData>(
        "https://api.example.com/items/1",
        requestData,
      );

      expect(result).toEqual(responseData);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/items/1",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify(requestData),
        }),
      );
    });

    it("handles null as body", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", mockFetch);

      await putJson("https://api.example.com/reset", null);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/reset",
        expect.objectContaining({
          body: "null",
        }),
      );
    });
  });

  describe("deleteRequest", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("sends DELETE request", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 200 }));
      vi.stubGlobal("fetch", mockFetch);

      const result = await deleteRequest("https://api.example.com/items/1");

      expect(result).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/items/1",
        expect.objectContaining({
          method: "DELETE",
        }),
      );
    });

    it("parses JSON response when present", async () => {
      const responseData = { deleted: true, id: 1 };

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(responseData), { status: 200 }),
        );
      vi.stubGlobal("fetch", mockFetch);

      const result = await deleteRequest<typeof responseData>(
        "https://api.example.com/items/1",
      );

      expect(result).toEqual(responseData);
    });

    it("throws ApiError on non-ok response", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 404 }));
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        deleteRequest("https://api.example.com/items/999"),
      ).rejects.toThrow(ApiError);
    });

    it("includes status code in ApiError", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 403 }));
      vi.stubGlobal("fetch", mockFetch);

      try {
        await deleteRequest("https://api.example.com/items/999");
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        const error = e as ApiError;
        expect(error.statusCode).toBe(403);
      }
    });

    it("passes additional options", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 200 }));
      vi.stubGlobal("fetch", mockFetch);

      await deleteRequest("https://api.example.com/items/1", {
        headers: { Authorization: "Bearer token" },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/items/1",
        expect.objectContaining({
          headers: { Authorization: "Bearer token" },
        }),
      );
    });
  });

  describe("retryFetch", () => {
    it("returns result on first success", async () => {
      const fn = vi.fn().mockResolvedValueOnce({ data: "success" });

      const result = await retryFetch(fn);

      expect(result).toEqual({ data: "success" });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("retries on failure and eventually succeeds", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("Fail 1"))
        .mockRejectedValueOnce(new Error("Fail 2"))
        .mockResolvedValueOnce({ data: "success" });

      const result = await retryFetch(fn, {
        maxRetries: 3,
        initialDelay: 1,
      });

      expect(result).toEqual({ data: "success" });
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("throws after max retries exhausted", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("Always fails"));

      await expect(
        retryFetch(fn, { maxRetries: 3, initialDelay: 1 }),
      ).rejects.toThrow("Always fails");

      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("does not retry abort errors", async () => {
      const abortError = new DOMException("Aborted", "AbortError");
      const fn = vi.fn().mockRejectedValueOnce(abortError);

      await expect(
        retryFetch(fn, { maxRetries: 3, initialDelay: 1 }),
      ).rejects.toThrow("Aborted");

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("respects shouldRetry callback returning false", async () => {
      const fn = vi.fn().mockRejectedValue(new ApiError("Auth failed", 401));

      await expect(
        retryFetch(fn, {
          maxRetries: 3,
          initialDelay: 1,
          shouldRetry: (error) => (error as ApiError).statusCode !== 401,
        }),
      ).rejects.toThrow("Auth failed");

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("retries when shouldRetry returns true", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new ApiError("Server error", 500))
        .mockResolvedValueOnce("success");

      const result = await retryFetch(fn, {
        maxRetries: 3,
        initialDelay: 1,
        shouldRetry: (error) => (error as ApiError).statusCode === 500,
      });

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("applies delays between retries", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("Fail"))
        .mockResolvedValueOnce("success");

      const start = Date.now();

      await retryFetch(fn, {
        maxRetries: 2,
        initialDelay: 20,
      });

      const elapsed = Date.now() - start;

      // Should have at least ~20ms delay
      expect(elapsed).toBeGreaterThanOrEqual(15);
    });
  });

  describe("apiResponse", () => {
    it("creates JSON response with data", async () => {
      const data = { id: 1, name: "Test" };
      const response = apiResponse(data);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/json");

      const body = await response.json();
      expect(body).toEqual(data);
    });

    it("creates response with custom status code", async () => {
      const response = apiResponse({ created: true }, 201);

      expect(response.status).toBe(201);
    });

    it("handles array data", async () => {
      const data = [1, 2, 3];
      const response = apiResponse(data);

      const body = await response.json();
      expect(body).toEqual(data);
    });

    it("handles null data", async () => {
      const response = apiResponse(null);

      const body = await response.json();
      expect(body).toBeNull();
    });

    it("handles string data", async () => {
      const response = apiResponse("simple string");

      const body = await response.json();
      expect(body).toBe("simple string");
    });

    it("handles boolean data", async () => {
      const response = apiResponse(true);

      const body = await response.json();
      expect(body).toBe(true);
    });

    it("handles number data", async () => {
      const response = apiResponse(42);

      const body = await response.json();
      expect(body).toBe(42);
    });
  });

  describe("apiErrorResponse", () => {
    it("creates error response with message", async () => {
      const response = apiErrorResponse("Something went wrong");

      expect(response.status).toBe(500);
      expect(response.headers.get("Content-Type")).toBe("application/json");

      const body = await response.json();
      expect(body.error).toBe("Something went wrong");
      expect(body.details).toBeUndefined();
    });

    it("creates error response with custom status code", async () => {
      const response = apiErrorResponse("Not found", 404);

      expect(response.status).toBe(404);
    });

    it("includes details object", async () => {
      const details = { field: "email", message: "Invalid format" };
      const response = apiErrorResponse("Validation failed", 400, details);

      const body = await response.json();
      expect(body.error).toBe("Validation failed");
      expect(body.details).toEqual(details);
    });

    it("includes string details", async () => {
      const response = apiErrorResponse("Error", 500, "Additional information");

      const body = await response.json();
      expect(body.details).toBe("Additional information");
    });

    it("includes null details", async () => {
      const response = apiErrorResponse("Error", 500, null);

      const body = await response.json();
      expect(body.details).toBeNull();
    });
  });

  describe("getErrorMessage", () => {
    it("extracts message from Error instance", () => {
      const error = new Error("Something went wrong");

      expect(getErrorMessage(error)).toBe("Something went wrong");
    });

    it("extracts message from ApiError instance", () => {
      const error = new ApiError("API failed", 500);

      expect(getErrorMessage(error)).toBe("API failed");
    });

    it("returns string error directly", () => {
      expect(getErrorMessage("String error")).toBe("String error");
    });

    it("returns default message for null", () => {
      expect(getErrorMessage(null)).toBe("An unknown error occurred");
    });

    it("returns default message for undefined", () => {
      expect(getErrorMessage(undefined)).toBe("An unknown error occurred");
    });

    it("handles empty string", () => {
      expect(getErrorMessage("")).toBe("");
    });

    it("handles Error with empty message", () => {
      expect(getErrorMessage(new Error(""))).toBe("");
    });
  });

  describe("isAbortError", () => {
    it("returns true for AbortError DOMException", () => {
      const error = new DOMException("Aborted", "AbortError");

      expect(isAbortError(error)).toBe(true);
    });

    it("returns false for other DOMException types", () => {
      const error = new DOMException("Network error", "NetworkError");

      expect(isAbortError(error)).toBe(false);
    });

    it("returns false for regular Error", () => {
      const error = new Error("Regular error");

      expect(isAbortError(error)).toBe(false);
    });

    it("returns false for ApiError", () => {
      const error = new ApiError("API error", 500);

      expect(isAbortError(error)).toBe(false);
    });

    it("returns false for null", () => {
      expect(isAbortError(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isAbortError(undefined)).toBe(false);
    });

    it("returns false for string", () => {
      expect(isAbortError("AbortError")).toBe(false);
    });
  });
});
