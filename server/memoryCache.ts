// Shared in-memory cache for when DB is unavailable
export const memoryCache = new Map<string, Record<string, unknown>>();
