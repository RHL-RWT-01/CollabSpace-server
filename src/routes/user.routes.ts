import { Router, Response } from 'express';
import {
  authenticate as authMiddleware,
  AuthenticatedRequest,
} from '../middleware/auth.middleware';
import { User } from '../models/User.model';
import { Export } from '../models/Export.model';
import { logger } from '../utils/logger.util';
import { getPlanLimits } from '../utils/plan-limits.util';
import { UsageTracker } from '../utils/usage-tracker.util';
import { APIResponse } from '../types';

const router = Router();

// GET /api/user/usage - Get comprehensive usage statistics
router.get(
  '/usage',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      const { month } = req.query;

      if (!userId) {
        return res
          .status(401)
          .json({ success: false, error: 'User not authenticated' });
      }

      const usageStats = await UsageTracker.getUsageStats(
        userId,
        month as string
      );

      res.json({ success: true, data: usageStats });
    } catch (error: any) {
      logger.error('Error fetching usage statistics:', error);
      res
        .status(500)
        .json({ success: false, error: 'Failed to fetch usage statistics' });
    }
  }
);

// GET /api/user/usage/history - Get historical usage data
router.get(
  '/usage/history',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      const { months = 6 } = req.query;

      if (!userId) {
        return res
          .status(401)
          .json({ success: false, error: 'User not authenticated' });
      }

      const historicalData = await UsageTracker.getHistoricalUsage(
        userId,
        Number(months)
      );

      res.json({ success: true, data: { history: historicalData } });
    } catch (error: any) {
      logger.error('Error fetching usage history:', error);
      res
        .status(500)
        .json({ success: false, error: 'Failed to fetch usage history' });
    }
  }
);

// GET /api/user/usage/projection - Get usage projection
router.get(
  '/usage/projection',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res
          .status(401)
          .json({ success: false, error: 'User not authenticated' });
      }

      const projection = await UsageTracker.getUsageProjection(userId);

      res.json({ success: true, data: { projection } });
    } catch (error: any) {
      logger.error('Error calculating usage projection:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to calculate usage projection',
      });
    }
  }
);

// GET /api/user/storage - Get user storage information
router.get(
  '/storage',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'User not authenticated',
        });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      // Get export statistics
      const exports = await Export.find({ userId }).sort({ createdAt: -1 });

      const exportsByFormat = {
        json: {
          count: 0,
          totalSize: 0,
        },
        png: {
          count: 0,
          totalSize: 0,
        },
      };

      exports.forEach((exp) => {
        if (exp.format === 'json') {
          exportsByFormat.json.count++;
          exportsByFormat.json.totalSize += exp.fileSizeBytes || 0;
        } else if (exp.format === 'png') {
          exportsByFormat.png.count++;
          exportsByFormat.png.totalSize += exp.fileSizeBytes || 0;
        }
      });

      // Get this month's export count
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const thisMonthExports = await Export.countDocuments({
        userId,
        createdAt: { $gte: startOfMonth },
      });

      // Get plan limits
      const planLimits = getPlanLimits(user.subscriptionPlan);
      const limitBytes =
        planLimits.storageGB === -1
          ? 'unlimited'
          : planLimits.storageGB * 1024 * 1024 * 1024; // Convert GB to bytes
      const usedBytes = user.storageUsedBytes || 0;
      const usagePercentage =
        limitBytes === 'unlimited'
          ? 0
          : Math.min((usedBytes / limitBytes) * 100, 100);

      const storageInfo = {
        totalUsedBytes: usedBytes,
        limitBytes: limitBytes,
        usagePercentage: usagePercentage,
        exportsCount: {
          total: exports.length,
          thisMonth: thisMonthExports,
        },
        exportsByFormat,
        lastExportAt: user.lastExportAt?.toISOString(),
        planName: user.subscriptionPlan,
      };

      res.json({
        success: true,
        data: storageInfo,
      });
    } catch (error) {
      logger.error('Error fetching user storage info:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }
);

// GET /api/user/exports - Get user's export history
router.get(
  '/exports',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      const { limit = 20, format, offset = 0 } = req.query;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'User not authenticated',
        });
      }

      const query: any = { userId };
      if (format && (format === 'json' || format === 'png')) {
        query.format = format;
      }

      const exports = await Export.find(query)
        .populate('roomId', 'name')
        .sort({ createdAt: -1 })
        .limit(Number(limit))
        .skip(Number(offset));

      const total = await Export.countDocuments(query);

      // Map exports to include room name
      const mappedExports = exports.map((exp) => ({
        id: exp._id,
        format: exp.format,
        fileName: exp.fileName,
        fileSize: exp.fileSizeBytes,
        downloadUrl: exp.s3Url,
        roomId: (exp.roomId as any)?._id?.toString() || exp.roomId.toString(),
        roomName: (exp.roomId as any)?.name || 'Untitled Room',
        createdAt: exp.createdAt,
        expiresAt: exp.expiresAt,
      }));

      res.json({
        success: true,
        data: {
          exports: mappedExports,
          total,
          hasMore: Number(offset) + exports.length < total,
        },
      });
    } catch (error) {
      logger.error('Error fetching user exports:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }
);

// DELETE /api/user/exports/cleanup - Clean up expired exports
router.delete(
  '/exports/cleanup',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'User not authenticated',
        });
      }

      // Find expired exports for this user
      const expiredExports = await Export.find({
        userId,
        expiresAt: { $lt: new Date() },
      });

      let cleanedCount = 0;

      for (const exp of expiredExports) {
        try {
          // Clean up the export (this will handle S3 deletion)
          await Export.findByIdAndDelete(exp._id);
          cleanedCount++;
        } catch (error) {
          logger.error(`Failed to cleanup export ${exp._id}:`, error);
        }
      }

      // Update user storage usage
      if (cleanedCount > 0) {
        const user = await User.findById(userId);
        if (user) {
          const remainingExports = await Export.find({ userId });
          const totalUsed = remainingExports.reduce(
            (sum, exp) => sum + (exp.fileSizeBytes || 0),
            0
          );
          await User.findByIdAndUpdate(userId, { storageUsedBytes: totalUsed });
        }
      }

      res.json({
        success: true,
        data: {
          cleaned: cleanedCount,
        },
      });
    } catch (error) {
      logger.error('Error cleaning up exports:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }
);

export default router;
