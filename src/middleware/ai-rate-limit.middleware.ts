import { Request, Response, NextFunction } from "express";
import { AuthenticatedRequest } from "./plan-enforcement.middleware";

interface RateLimitEntry {
  tokens: number;
  lastRefill: number;
}

// In-memory token bucket rate limiter
const rateLimitMap = new Map<string, RateLimitEntry>();

// Configuration
const AI_RATE_LIMIT_PER_HOUR = parseInt(
  process.env.AI_RATE_LIMIT_PER_HOUR || "20"
);
const REFILL_INTERVAL = 3600000; // 1 hour in milliseconds
const BUCKET_SIZE = AI_RATE_LIMIT_PER_HOUR;

export const aiRateLimitMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const userId = (req as AuthenticatedRequest).user?.id;

    if (!userId) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }

    const now = Date.now();
    const userKey = `ai_rate_limit:${userId}`;

    // Get or create rate limit entry
    let entry = rateLimitMap.get(userKey);

    if (!entry) {
      entry = {
        tokens: BUCKET_SIZE,
        lastRefill: now,
      };
      rateLimitMap.set(userKey, entry);
    }

    // Calculate tokens to add based on time elapsed
    const timeElapsed = now - entry.lastRefill;
    const tokensToAdd = Math.floor(timeElapsed / REFILL_INTERVAL) * BUCKET_SIZE;

    if (tokensToAdd > 0) {
      entry.tokens = Math.min(BUCKET_SIZE, entry.tokens + tokensToAdd);
      entry.lastRefill = now;
    }

    // Check if user has tokens available
    if (entry.tokens < 1) {
      const retryAfter = Math.ceil(
        (REFILL_INTERVAL - (now - entry.lastRefill)) / 1000
      );
      res
        .status(429)
        .json({
          message: "AI rate limit exceeded. Please try again later.",
          retryAfter,
        })
        .header("Retry-After", retryAfter.toString());
      return;
    }

    // Consume one token
    entry.tokens -= 1;
    rateLimitMap.set(userKey, entry);

    // Add rate limit info to response headers
    res.header("X-RateLimit-Limit", BUCKET_SIZE.toString());
    res.header("X-RateLimit-Remaining", entry.tokens.toString());
    res.header(
      "X-RateLimit-Reset",
      new Date(entry.lastRefill + REFILL_INTERVAL).toISOString()
    );

    next();
  } catch (error) {
    console.error("Error in AI rate limit middleware:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Cleanup function to remove expired entries (call periodically)
export const cleanupRateLimitEntries = (): void => {
  const now = Date.now();
  const expiredThreshold = now - REFILL_INTERVAL * 2; // Keep entries for 2 refill cycles

  for (const [key, entry] of rateLimitMap.entries()) {
    if (entry.lastRefill < expiredThreshold) {
      rateLimitMap.delete(key);
    }
  }
};

// Set up periodic cleanup
setInterval(cleanupRateLimitEntries, REFILL_INTERVAL);

