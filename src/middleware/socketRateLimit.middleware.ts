import { redisClient } from "../config/database";
import { logger } from "../utils/logger.util";
import { Socket } from "socket.io";

interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
  skipAnonymous?: boolean;
  keyGenerator?: (socket: Socket, eventName: string) => string;
}

const defaultOptions: RateLimitOptions = {
  maxRequests: 100,
  windowMs: 60000, // 1 minute
  skipAnonymous: false,
  keyGenerator: (socket: Socket, eventName: string) => {
    const userId = socket.data?.user?.id || "anonymous";
    return `ratelimit:socket:${userId}:${eventName}`;
  },
};

/**
 * Create a rate limiter factory with custom options
 */
export const createSocketRateLimiter = (
  options: Partial<RateLimitOptions> = {}
) => {
  const config = { ...defaultOptions, ...options };

  return (eventName: string, handler: Function) => {
    return async (socket: Socket, data: any) => {
      try {
        // Skip rate limiting for anonymous users if configured
        if (config.skipAnonymous && socket.data?.user?.isAnonymous) {
          return handler(socket, data);
        }

        // Generate rate limit key
        const key = config.keyGenerator!(socket, eventName);

        // Increment counter using Redis INCR
        const current = await redisClient.incr(key);

        // If this is the first request, set expiration
        if (current === 1) {
          await redisClient.pExpire(key, config.windowMs);
        }

        // Check if limit exceeded
        if (current > config.maxRequests) {
          socket.emit("error", {
            code: "RATE_LIMIT_EXCEEDED",
            message: `Rate limit exceeded for ${eventName}. Max ${config.maxRequests} requests per ${config.windowMs / 1000} seconds.`,
            timestamp: new Date().toISOString(),
          });

          logger.warn(
            `Rate limit exceeded for user ${socket.data?.user?.id || "anonymous"} on event ${eventName}`
          );
          return;
        }

        // Allow the event to proceed
        return handler(socket, data);
      } catch (error) {
        // Fail-open approach: if Redis is unavailable, allow the request
        logger.error("Rate limiting error:", error);
        return handler(socket, data);
      }
    };
  };
};

/**
 * Default rate limiter with standard limits
 */
export const socketRateLimiter = createSocketRateLimiter();
