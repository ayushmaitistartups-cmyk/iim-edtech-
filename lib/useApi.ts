"use client";

import { useAuth } from "@clerk/nextjs";
import { useMemo } from "react";

const DEFAULT_BACKEND_URL = "http://localhost:8000";

export class BackendApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "BackendApiError";
    this.status = status;
    this.code = code;
  }
}

type ApiCallInit = Omit<RequestInit, "body"> & {
  body?: unknown;
};

interface BackendErrorBody {
  detail?: {
    code?: string;
    message?: string;
  };
  error?: string;
}

function backendBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_BACKEND_URL ?? DEFAULT_BACKEND_URL).replace(/\/$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseError(response: Response): Promise<BackendApiError> {
  let body: BackendErrorBody | null = null;
  try {
    body = (await response.json()) as BackendErrorBody;
  } catch {
    body = null;
  }

  const detail = body?.detail;
  const code = detail?.code ?? body?.error ?? `HTTP_${response.status}`;
  const message = detail?.message ?? body?.error ?? response.statusText;
  return new BackendApiError(response.status, code, message);
}

export function useApi() {
  const { getToken } = useAuth();

  return useMemo(
    () => ({
      async call<TResponse>(path: string, init: ApiCallInit = {}): Promise<TResponse> {
        const token = await getToken();
        if (!token) {
          throw new BackendApiError(401, "UNAUTHORIZED", "Please sign in again.");
        }

        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${token}`);

        let body: BodyInit | null | undefined;
        if (init.body === undefined || init.body === null) {
          body = undefined;
        } else if (
          typeof init.body === "string" ||
          init.body instanceof Blob ||
          init.body instanceof ArrayBuffer ||
          init.body instanceof FormData ||
          init.body instanceof URLSearchParams ||
          init.body instanceof ReadableStream
        ) {
          body = init.body;
        } else if (isRecord(init.body)) {
          headers.set("Content-Type", "application/json");
          body = JSON.stringify(init.body);
        } else {
          throw new BackendApiError(400, "INVALID_BODY", "Unsupported API request body.");
        }

        const response = await fetch(`${backendBaseUrl()}${path}`, {
          ...init,
          headers,
          body,
        });

        if (!response.ok) {
          throw await parseError(response);
        }

        if (response.status === 204) {
          return undefined as TResponse;
        }

        return (await response.json()) as TResponse;
      },
    }),
    [getToken]
  );
}
