import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../config/database';
import { logger } from '../utils/logger.util';


interface RateLimitOptions {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum number of requests per window
  message?: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

// Rate limiter factory function
export const createRateLimit = (options: RateLimitOptions) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = `rate_limit:${req.ip}:${req.route?.path || req.path}`;
      const current = await redisClient.get(key);
      
      if (current === null) {
        // First request in this window
        await redisClient.setEx(key, Math.ceil(options.windowMs / 1000), '1');
        next();
        return;
      }

      const requests = parseInt(current, 10);
      
      if (requests >= options.maxRequests) {
        res.status(429).json({
          success: false,
          message: options.message || 'Too many requests, please try again later.',
          retryAfter: await redisClient.ttl(key),
        });
        return;
      }

      // Increment counter
      await redisClient.incr(key);
      next();
    } catch (error) {
      logger.error('Rate limiting error:', error);
      // If Redis is down, allow the request to proceed
      next();
    }
  };
};

// Pre-configured rate limiters for different route types

// Strict rate limiting for authentication routes
export const authRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5, // 5 attempts per 15 minutes
  message: 'Too many authentication attempts, please try again later.',
});

// Moderate rate limiting for general API routes
export const apiRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100, // 100 requests per 15 minutes
  message: 'Too many API requests, please try again later.',
});

// Conservative rate limiting for AI routes (more expensive)
export const aiRateLimit = createRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 10, // 10 AI requests per hour for free users
  message: 'AI request limit exceeded, please try again later or upgrade your plan.',
});

// File upload rate limiting
export const uploadRateLimit = createRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 20, // 20 uploads per hour
  message: 'Upload limit exceeded, please try again later.',
});

// Billing/webhook rate limiting
export const billingRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100, // 100 requests per minute (for webhooks)
  message: 'Billing request limit exceeded.',
});