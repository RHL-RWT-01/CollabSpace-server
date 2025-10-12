import { UsageTracking } from "../models/UsageTracking.model";
import { Subscription } from "../models/Subscription.model";
import { SubscriptionPlan } from "../types";
import { getPlanLimits, formatUsageStats } from "./plan-limits.util";
import { logger } from "./logger.util";

interface UsageWarning {
  type: string;
  level: "warning" | "critical";
  message: string;
  current: any;
  limit: any;
}

export class UsageTracker {
  // Get consolidated usage stats for dashboard
  static async getUsageStats(userId: string, month?: string) {
    try {
      const currentMonth = month || new Date().toISOString().slice(0, 7); // YYYY-MM

      const usage = await UsageTracking.getCurrentUsage(userId);
      const subscription = await Subscription.findOne({ userId });

      const plan = subscription?.plan || SubscriptionPlan.FREE;
      const limits = getPlanLimits(plan);

      // Format usage with calculated percentages and remaining values
      const formattedStats = formatUsageStats(usage, plan);

      return {
        month: currentMonth,
        plan,
        subscription: subscription
          ? {
              status: subscription.status,
              currentPeriodEnd: subscription.currentPeriodEnd,
              daysUntilRenewal: subscription.daysUntilRenewal(),
              cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            }
          : null,
        usage: {
          current: {
            aiRequestsCount: usage.aiRequestsCount,
            roomsCreatedCount: usage.roomsCreatedCount,
            exportsCount: usage.exportsCount,
            storageUsedBytes: usage.storageUsedBytes,
          },
          formatted: formattedStats,
        },
        limits,
        warnings: UsageTracker.getUsageWarnings(usage, plan),
      };
    } catch (error: any) {
      logger.error("Error getting usage stats:", error);
      throw new Error("Failed to get usage statistics");
    }
  }

  // Increment AI request counter
  static async incrementAIRequests(userId: string, count = 1) {
    try {
      return await UsageTracking.incrementAIRequests(userId);
    } catch (error: any) {
      logger.error("Error incrementing AI requests:", error);
      // Don't throw error for usage tracking failures
    }
  }

  // Increment export counter
  static async incrementExports(userId: string, count = 1) {
    try {
      return await UsageTracking.incrementExports(userId);
    } catch (error: any) {
      logger.error("Error incrementing exports:", error);
      // Don't throw error for usage tracking failures
    }
  }

  // Update storage usage
  static async updateStorage(userId: string, bytes: number) {
    try {
      return await UsageTracking.updateStorage(userId, bytes);
    } catch (error: any) {
      logger.error("Error updating storage:", error);
      // Don't throw error for usage tracking failures
    }
  }

  // Reset monthly counters (typically called by cron job)
  static async resetMonthlyCounters(userId: string) {
    try {
      return await UsageTracking.resetMonthlyCounters(userId);
    } catch (error: any) {
      logger.error("Error resetting monthly counters:", error);
      throw error;
    }
  }

  // Check if user has reached any limits
  static async hasReachedAnyLimit(userId: string, plan: SubscriptionPlan) {
    try {
      const aiLimitReached = await UsageTracking.hasReachedLimit(
        userId,
        "aiRequests",
        plan
      );
      const exportsLimitReached = await UsageTracking.hasReachedLimit(
        userId,
        "exports",
        plan
      );
      const storageLimitReached = await UsageTracking.hasReachedLimit(
        userId,
        "storage",
        plan
      );

      return {
        aiRequests: aiLimitReached,
        exports: exportsLimitReached,
        storage: storageLimitReached,
        any: aiLimitReached || exportsLimitReached || storageLimitReached,
      };
    } catch (error: any) {
      logger.error("Error checking limits:", error);
      return {
        aiRequests: false,
        exports: false,
        storage: false,
        any: false,
      };
    }
  }

  // Get usage warnings when approaching limits
  static getUsageWarnings(usage: any, plan: SubscriptionPlan): UsageWarning[] {
    const limits = getPlanLimits(plan);
    const warnings: UsageWarning[] = [];

    // AI requests warning (80% threshold)
    if (limits.aiRequestsPerMonth > 0) {
      const percentage =
        (usage.aiRequestsCount / limits.aiRequestsPerMonth) * 100;
      if (percentage >= 80) {
        warnings.push({
          type: "aiRequests",
          level: percentage >= 95 ? "critical" : "warning",
          message: `You've used ${Math.round(percentage)}% of your AI requests this month`,
          current: usage.aiRequestsCount,
          limit: limits.aiRequestsPerMonth,
        });
      }
    }

    // Exports warning (80% threshold)
    if (limits.exportsPerMonth > 0) {
      const percentage = (usage.exportsCount / limits.exportsPerMonth) * 100;
      if (percentage >= 80) {
        warnings.push({
          type: "exports",
          level: percentage >= 95 ? "critical" : "warning",
          message: `You've used ${Math.round(percentage)}% of your exports this month`,
          current: usage.exportsCount,
          limit: limits.exportsPerMonth,
        });
      }
    }

    // Storage warning (80% threshold)
    if (limits.storageGB > 0) {
      const storageGB = usage.storageUsedBytes / (1024 * 1024 * 1024);
      const percentage = (storageGB / limits.storageGB) * 100;
      if (percentage >= 80) {
        warnings.push({
          type: "storage",
          level: percentage >= 95 ? "critical" : "warning",
          message: `You've used ${Math.round(percentage)}% of your storage`,
          current: `${Math.round(storageGB * 100) / 100} GB`,
          limit: `${limits.storageGB} GB`,
        });
      }
    }

    return warnings;
  }

  // Get historical usage data for charts/analytics
  static async getHistoricalUsage(userId: string, months = 6) {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(endDate.getMonth() - months);

      const usage = await UsageTracking.find({
        userId,
        month: {
          $gte: startDate.toISOString().slice(0, 7),
          $lte: endDate.toISOString().slice(0, 7),
        },
      }).sort({ month: 1 });

      return usage.map((u) => ({
        month: u.month,
        aiRequestsCount: u.aiRequestsCount,
        exportsCount: u.exportsCount,
        storageUsedBytes: u.storageUsedBytes,
        roomsCreatedCount: u.roomsCreatedCount,
      }));
    } catch (error: any) {
      logger.error("Error getting historical usage:", error);
      throw new Error("Failed to get historical usage data");
    }
  }

  // Calculate projected usage based on current trends
  static async getUsageProjection(userId: string) {
    try {
      const currentMonth = new Date().toISOString().slice(0, 7);
      const currentUsage = await UsageTracking.findOne({
        userId,
        month: currentMonth,
      });

      if (!currentUsage) {
        return null;
      }

      const daysInMonth = new Date().getDate();
      const daysRemaining =
        new Date(
          new Date().getFullYear(),
          new Date().getMonth() + 1,
          0
        ).getDate() - daysInMonth;

      const dailyAverage = {
        aiRequests: currentUsage.aiRequestsCount / daysInMonth,
        exports: currentUsage.exportsCount / daysInMonth,
      };

      const projection = {
        aiRequests: Math.round(
          currentUsage.aiRequestsCount + dailyAverage.aiRequests * daysRemaining
        ),
        exports: Math.round(
          currentUsage.exportsCount + dailyAverage.exports * daysRemaining
        ),
      };

      return {
        current: {
          aiRequests: currentUsage.aiRequestsCount,
          exports: currentUsage.exportsCount,
        },
        projected: projection,
        daysRemaining,
      };
    } catch (error: any) {
      logger.error("Error calculating usage projection:", error);
      return null;
    }
  }

  // Batch update storage for multiple users (for maintenance tasks)
  static async batchUpdateStorage(
    updates: Array<{ userId: string; bytes: number }>
  ) {
    try {
      const results = await Promise.allSettled(
        updates.map((update) =>
          UsageTracking.updateStorage(update.userId, update.bytes)
        )
      );

      const successful = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      logger.info(
        `Batch storage update completed: ${successful} successful, ${failed} failed`
      );

      return { successful, failed };
    } catch (error: any) {
      logger.error("Error in batch storage update:", error);
      throw error;
    }
  }
}

