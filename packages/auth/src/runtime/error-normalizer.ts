import type { AuthErrorInfo } from '../state-machine/index.js';

export function normalizeAuthError(error: unknown): AuthErrorInfo {
  const timestamp = Date.now();
  if (!error) {
    return {
      code: 'AUTH_UNKNOWN_ERROR',
      message: 'An unexpected authentication error occurred.',
      recoverable: true,
      timestamp,
    };
  }

  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Authentication error';

  // Redact any Bearer tokens or JWT-like patterns
  const safeMessage = rawMessage
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]');

  const status = (error as { status?: number })?.status;
  if (status === 401 || /invalid credential|unauthorized/i.test(safeMessage)) {
    return {
      code: 'AUTH_INVALID_CREDENTIALS',
      message: safeMessage,
      recoverable: true,
      timestamp,
    };
  }
  if (status === 403 || /suspended|forbidden/i.test(safeMessage)) {
    return {
      code: 'AUTH_FORBIDDEN',
      message: safeMessage,
      recoverable: false,
      timestamp,
    };
  }
  if (status === 429 || /rate limit/i.test(safeMessage)) {
    return {
      code: 'AUTH_RATE_LIMITED',
      message: safeMessage,
      recoverable: true,
      timestamp,
    };
  }
  if (/network|timeout|abort/i.test(safeMessage)) {
    return {
      code: 'AUTH_NETWORK_ERROR',
      message: safeMessage,
      recoverable: true,
      timestamp,
    };
  }

  return {
    code: 'AUTH_OPERATION_FAILED',
    message: safeMessage,
    recoverable: true,
    timestamp,
  };
}
