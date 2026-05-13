/**
 * Centralized error message extraction utility.
 *
 * Many libraries (Supabase PostgrestError, Stripe SDK, @fastshot/ai)
 * reject with non-Error objects or plain objects without a standard
 * `.message` property. This utility handles all known shapes and
 * guarantees a non-empty, human-readable error string is returned.
 *
 * Previously, catch blocks that only checked `e instanceof Error`
 * would miss these, causing blank `{}` error messages in the UI.
 */

/**
 * Extract a meaningful error message from any thrown value.
 * Handles: Error instances, Supabase PostgrestError objects,
 * Stripe SDK error objects, plain objects with various message fields,
 * strings, and completely unknown shapes.
 *
 * @param error - The caught error value (unknown type)
 * @param fallback - Fallback message if no meaningful message can be extracted
 * @returns A non-empty human-readable error string
 */
export function extractErrorMessage(
  error: unknown,
  fallback = 'An unexpected error occurred. Please try again.'
): string {
  // Null/undefined
  if (error == null) return fallback;

  // Standard Error instance
  if (error instanceof Error) {
    return error.message || fallback;
  }

  // String thrown directly
  if (typeof error === 'string') {
    return error || fallback;
  }

  // Object-shaped errors (Supabase PostgrestError, Stripe SDK errors, etc.)
  if (typeof error === 'object') {
    const obj = error as Record<string, unknown>;

    // Most common: .message property (Supabase PostgrestError, custom errors)
    if (typeof obj.message === 'string' && obj.message) {
      return obj.message;
    }

    // Stripe SDK: .error property (string)
    if (typeof obj.error === 'string' && obj.error) {
      return obj.error;
    }

    // Stripe SDK nested: .error.message
    if (typeof obj.error === 'object' && obj.error !== null) {
      const nested = obj.error as Record<string, unknown>;
      if (typeof nested.message === 'string' && nested.message) {
        return nested.message;
      }
    }

    // React Native/Stripe: .localizedMessage
    if (typeof obj.localizedMessage === 'string' && obj.localizedMessage) {
      return obj.localizedMessage;
    }

    // Supabase: .details or .hint
    if (typeof obj.details === 'string' && obj.details) {
      return obj.details;
    }
    if (typeof obj.hint === 'string' && obj.hint) {
      return obj.hint;
    }

    // Supabase: .code (at least gives some info)
    if (typeof obj.code === 'string' && obj.code) {
      return `Error code: ${obj.code}`;
    }

    // Last resort: try JSON.stringify, but skip if it produces `{}`
    try {
      const serialized = JSON.stringify(obj);
      if (serialized && serialized !== '{}' && serialized !== '[]') {
        // Truncate very long serialized errors
        const truncated = serialized.length > 300
          ? serialized.substring(0, 300) + '...'
          : serialized;
        return `Error: ${truncated}`;
      }
    } catch {
      // JSON.stringify can throw on circular references
    }

    return fallback;
  }

  // Number, boolean, symbol, etc.
  const str = String(error);
  return str && str !== 'undefined' && str !== 'null' ? str : fallback;
}

/**
 * Safely log an error to console with a prefix, ensuring the full
 * error details are captured even for non-Error objects.
 */
export function logError(prefix: string, error: unknown): void {
  const message = extractErrorMessage(error);

  // Log the readable message plus the raw error for debugging
  if (error instanceof Error) {
    console.error(`${prefix}:`, message, error);
  } else if (typeof error === 'object' && error !== null) {
    try {
      console.error(`${prefix}:`, message, JSON.stringify(error, null, 2));
    } catch {
      console.error(`${prefix}:`, message, error);
    }
  } else {
    console.error(`${prefix}:`, message);
  }
}
