/**
 * Typed Tauri invoke wrapper that unwraps Rust `AppError` rejections
 * into a JS-idiomatic `AppErrorInstance`.
 *
 * audit-#17: deduped from the per-entity copies that used to live in
 * every `src/entities/<x>/api/<x>Api.ts`. Single source of truth here
 * keeps the discriminator + formatter aligned with the ts-rs binding.
 */

import type { AppError } from "@bindings/AppError";

import { invoke } from "./invoke";

/**
 * Typed error wrapper around the Rust `AppError` enum.
 *
 * Why a class? Promise rejections from Tauri come through as the
 * deserialised JSON object — instanceof-checking that against a class
 * gives us a stable JS-idiomatic catch path (`if (e instanceof
 * AppErrorInstance)`) AND keeps the typed `.error` payload available
 * for discriminated-union narrowing on `.kind`.
 */
export class AppErrorInstance extends Error {
  /** The discriminated-union payload from `bindings/AppError.ts`. */
  public readonly error: AppError;

  public constructor(error: AppError) {
    super(formatAppErrorMessage(error));
    this.name = "AppErrorInstance";
    this.error = error;
    Object.setPrototypeOf(this, AppErrorInstance.prototype);
  }

  /** Convenience accessor — `error.kind` short-hand. */
  public get kind(): AppError["kind"] {
    return this.error.kind;
  }
}

/** Render an AppError into a human-readable single line. */
function formatAppErrorMessage(error: AppError): string {
  switch (error.kind) {
    case "validation":
      return `Validation failed: ${error.data.field} — ${error.data.reason}`;
    case "transactionRolledBack":
      return `Transaction rolled back: ${error.data.reason}`;
    case "dbBusy":
      return "Database is busy. Please retry.";
    case "lockTimeout":
      return `Lock timeout on resource: ${error.data.resource}`;
    case "internalPanic":
      return `Internal panic in ${error.data.handler}: ${error.data.message}`;
    case "notFound":
      return `${error.data.entity} not found (id: ${error.data.id})`;
    case "conflict":
      return `Conflict on ${error.data.entity}: ${error.data.reason}`;
    case "secretAccessDenied":
      return `Access denied for secret: ${error.data.secretRef}`;
    case "forbidden":
      return `Forbidden: ${error.data.reason}`;
    case "badRequest":
      return `Bad request: ${error.data.reason}`;
    default: {
      const exhaustive: never = error;
      return `Unknown error: ${JSON.stringify(exhaustive)}`;
    }
  }
}

/** Runtime guard — does the unknown payload match the AppError shape? */
export function isAppErrorShape(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (typeof kind !== "string") return false;
  return (
    kind === "validation" ||
    kind === "transactionRolledBack" ||
    kind === "dbBusy" ||
    kind === "lockTimeout" ||
    kind === "internalPanic" ||
    kind === "notFound" ||
    kind === "conflict" ||
    kind === "secretAccessDenied" ||
    kind === "forbidden" ||
    kind === "badRequest"
  );
}

/**
 * Wrap a Tauri command call so any AppError-shaped rejection becomes
 * a typed `AppErrorInstance`. Other rejections pass through unchanged
 * so callers can still differentiate IO/transport errors from domain
 * ones.
 */
export async function invokeWithAppError<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    if (isAppErrorShape(raw)) {
      throw new AppErrorInstance(raw);
    }
    throw raw;
  }
}
