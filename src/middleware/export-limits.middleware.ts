import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.middleware';
import { User } from '../models/User.model';
import { redisClient } from '../config/database';
import { getPlanLimits } from '../utils/plan-limits.util';


interface ExtendedAuthenticatedRequest extends AuthenticatedRequest {
  body: {
    estimatedSize?: number;
    [key: string]: any;
  };
}

export const checkExportLimits = async (
  req: ExtendedAuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    // Fetch user with subscription plan
    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    // Get plan limits
    const planLimits = getPlanLimits(user.subscriptionPlan);
    const estimatedSize = req.body.estimatedSize || 5 * 1024 * 1024; // Default 5MB

    // Check storage availability
    if (!user.hasStorageAvailable(estimatedSize)) {
      const usageGB = user.getStorageUsageGB();
      res.status(403).json({
        message: 'Storage limit exceeded',
        currentUsage: `${usageGB.toFixed(2)} GB`,
        limit: `${planLimits.storageGB} GB`,
        error: 'STORAGE_LIMIT_EXCEEDED',
      });
      return;
    }

    // Check daily export limit
    const dailyLimits = {
      FREE: parseInt(process.env.EXPORT_DAILY_LIMIT_FREE || '5'),
      PRO: parseInt(process.env.EXPORT_DAILY_LIMIT_PRO || '50'),
      TEAMS: parseInt(process.env.EXPORT_DAILY_LIMIT_TEAMS || '-1'),
    };

    const dailyLimit =
      dailyLimits[user.subscriptionPlan as keyof typeof dailyLimits];

    if (dailyLimit > 0) {
      const exportCount = await getExportCountToday(userId);

      if (exportCount >= dailyLimit) {
        res.status(429).json({
          message: 'Daily export limit exceeded',
          currentCount: exportCount,
          limit: dailyLimit,
          error: 'DAILY_LIMIT_EXCEEDED',
        });
        return;
      }
    }

    // All checks passed
    next();
  } catch (error) {
    console.error('Error in export limits middleware:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getExportCountToday = async (userId: string): Promise<number> => {
  const today = new Date().toISOString().split('T')[0];
  const key = `export:count:${userId}:${today}`;

  try {
    const count = await redisClient.get(key);
    return count ? parseInt(count) : 0;
  } catch (error) {
    console.error('Error getting export count from Redis:', error);
    return 0;
  }
};

export const incrementExportCount = async (userId: string): Promise<void> => {
  const today = new Date().toISOString().split('T')[0];
  const key = `export:count:${userId}:${today}`;

  try {
    await redisClient.incr(key);
    await redisClient.expire(key, 24 * 60 * 60); // 24 hours TTL
  } catch (error) {
    console.error('Error incrementing export count in Redis:', error);
  }
};
