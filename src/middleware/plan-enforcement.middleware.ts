import { Request, Response, NextFunction } from "express";
import { Subscription } from "../models/Subscription.model";
import { UsageTracking } from "../models/UsageTracking.model";
import { SubscriptionPlan, APIResponse } from "../types";
import { getPlanLimits } from "../utils/plan-limits.util";
import { UsageTracker } from "../utils/usage-tracker.util";
import { logger } from "../utils/logger.util";
import { Room } from "../models/Room.model";

export interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    email: string;
    name: string;
    plan: SubscriptionPlan;
    subscriptionPlan: SubscriptionPlan; // For backward compatibility
  };
  incrementAIUsage?: () => Promise<any>;
  incrementExportUsage?: () => Promise<any>;
}

export class PlanEnforcementMiddleware {
  // Check if user has access to feature
  static checkFeatureAccess(requiredPlan: SubscriptionPlan) {
    return async (
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction
    ) => {
      try {
        const userPlan = req.user.plan || req.user.subscriptionPlan;

        if (
          !PlanEnforcementMiddleware.hasFeatureAccess(userPlan, requiredPlan)
        ) {
          return res.status(403).json({
            success: false,
            error: "Upgrade required",
            data: {
              currentPlan: userPlan,
              requiredPlan,
              upgradeMessage: `This feature requires ${requiredPlan} plan or higher`,
            },
          });
        }

        next();
      } catch (error: any) {
        logger.error("Error checking feature access:", error);
        res
          .status(500)
          .json({ success: false, error: "Failed to check feature access" });
      }
    };
  }

  // Check AI requests limit and optionally increment usage
  static checkAIRequestsLimit(options: { incrementUsage?: boolean } = {}) {
    return async (
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction
    ) => {
      try {
        const userId = req.user.id;
        const userPlan = req.user.plan || req.user.subscriptionPlan;

        const hasReachedLimit = await UsageTracking.hasReachedLimit(
          userId,
          "aiRequests",
          userPlan
        );

        if (hasReachedLimit) {
          const usage = await UsageTracking.getCurrentUsage(userId);
          const limits = getPlanLimits(userPlan);

          return res.status(429).json({
            success: false,
            error: "AI requests limit reached",
            data: {
              usage: {
                current: usage.aiRequestsCount,
                limit: limits.aiRequestsPerMonth,
              },
              upgradeRequired: userPlan === SubscriptionPlan.FREE,
              upgradeMessage: `You have reached your monthly limit of ${limits.aiRequestsPerMonth} AI requests`,
            },
          });
        }

        // Increment usage if requested (for post-processing)
        if (options.incrementUsage) {
          req.incrementAIUsage = () => UsageTracker.incrementAIRequests(userId);
        }

        next();
      } catch (error: any) {
        logger.error("Error checking AI requests limit:", error);
        res
          .status(500)
          .json({ success: false, error: "Failed to check AI requests limit" });
      }
    };
  }

  // Check exports limit and optionally increment usage
  static checkExportsLimit(options: { incrementUsage?: boolean } = {}) {
    return async (
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction
    ) => {
      try {
        const userId = req.user.id;
        const userPlan = req.user.plan || req.user.subscriptionPlan;

        const hasReachedLimit = await UsageTracking.hasReachedLimit(
          userId,
          "exports",
          userPlan
        );

        if (hasReachedLimit) {
          const usage = await UsageTracking.getCurrentUsage(userId);
          const limits = getPlanLimits(userPlan);

          return res.status(429).json({
            success: false,
            error: "Exports limit reached",
            data: {
              usage: {
                current: usage.exportsCount,
                limit: limits.exportsPerMonth,
              },
              upgradeRequired: userPlan === SubscriptionPlan.FREE,
              upgradeMessage: `You have reached your monthly limit of ${limits.exportsPerMonth} exports`,
            },
          });
        }

        // Increment usage if requested (for post-processing)
        if (options.incrementUsage) {
          req.incrementExportUsage = () =>
            UsageTracker.incrementExports(userId);
        }

        next();
      } catch (error: any) {
        logger.error("Error checking exports limit:", error);
        res
          .status(500)
          .json({ success: false, error: "Failed to check exports limit" });
      }
    };
  }

  // Check storage limit
  static checkStorageLimit() {
    return async (
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction
    ) => {
      try {
        const userId = req.user.id;
        const userPlan = req.user.plan;

        const hasReachedLimit = await UsageTracking.hasReachedLimit(
          userId,
          "storage",
          userPlan
        );

        if (hasReachedLimit) {
          const usage = await UsageTracking.getCurrentUsage(userId);
          const limits = getPlanLimits(userPlan);

          return res.status(429).json({
            error: "Storage limit reached",
            message: `You have reached your storage limit of ${limits.storageGB}GB`,
            usage: {
              current:
                Math.round(
                  (usage.storageUsedBytes / (1024 * 1024 * 1024)) * 100
                ) / 100,
              limit: limits.storageGB,
            },
            upgradeRequired: userPlan === SubscriptionPlan.FREE,
          });
        }

        next();
      } catch (error: any) {
        logger.error("Error checking storage limit:", error);
        res.status(500).json({ error: "Failed to check storage limit" });
      }
    };
  }

  // Check room creation limit
  static checkRoomCreationLimit() {
    return async (
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction
    ) => {
      try {
        const userId = req.user.id;
        const userPlan = req.user.plan;
        const limits = getPlanLimits(userPlan);

        // If unlimited rooms, allow creation
        if (limits.maxRooms === -1) {
          return next();
        }

        // Count current rooms for the user
        const currentRoomCount = await Room.countDocuments({ userId });

        if (currentRoomCount >= limits.maxRooms) {
          return res.status(429).json({
            error: "Room limit reached",
            message: `You have reached your limit of ${limits.maxRooms} rooms`,
            usage: {
              current: currentRoomCount,
              limit: limits.maxRooms,
            },
            upgradeRequired: userPlan === SubscriptionPlan.FREE,
          });
        }

        next();
      } catch (error: any) {
        logger.error("Error checking room creation limit:", error);
        res.status(500).json({ error: "Failed to check room creation limit" });
      }
    };
  }

  // Check collaboration limit
  static checkCollaborationLimit() {
    return async (
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction
    ) => {
      try {
        const userPlan = req.user.plan;
        const limits = getPlanLimits(userPlan);

        if (!limits.collaboration) {
          return res.status(403).json({
            error: "Collaboration not available",
            message: "Collaboration features require a Pro plan or higher",
            currentPlan: userPlan,
            requiredPlan: SubscriptionPlan.PRO,
          });
        }

        next();
      } catch (error: any) {
        logger.error("Error checking collaboration limit:", error);
        res.status(500).json({ error: "Failed to check collaboration limit" });
      }
    };
  }

  // Check advanced AI features
  static checkAdvancedAIAccess() {
    return async (
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction
    ) => {
      try {
        const userPlan = req.user.plan;
        const limits = getPlanLimits(userPlan);

        if (!limits.advancedAI) {
          return res.status(403).json({
            error: "Advanced AI not available",
            message: "Advanced AI features require a Pro plan or higher",
            currentPlan: userPlan,
            requiredPlan: SubscriptionPlan.PRO,
          });
        }

        next();
      } catch (error: any) {
        logger.error("Error checking advanced AI access:", error);
        res.status(500).json({ error: "Failed to check advanced AI access" });
      }
    };
  }

  // Check priority support access
  static checkPrioritySupportAccess() {
    return async (
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction
    ) => {
      try {
        const userPlan = req.user.plan;
        const limits = getPlanLimits(userPlan);

        if (!limits.prioritySupport) {
          return res.status(403).json({
            error: "Priority support not available",
            message: "Priority support requires a Teams plan",
            currentPlan: userPlan,
            requiredPlan: SubscriptionPlan.TEAMS,
          });
        }

        next();
      } catch (error: any) {
        logger.error("Error checking priority support access:", error);
        res
          .status(500)
          .json({ error: "Failed to check priority support access" });
      }
    };
  }

  // Increment usage counters
  static incrementAIUsage() {
    return async (
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction
    ) => {
      try {
        const userId = req.user.id;
        await UsageTracking.incrementAIRequests(userId);
        next();
      } catch (error: any) {
        logger.error("Error incrementing AI usage:", error);
        // Don't block the request for usage tracking errors
        next();
      }
    };
  }

  static incrementExportUsage() {
    return async (
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction
    ) => {
      try {
        const userId = req.user.id;
        await UsageTracking.incrementExports(userId);
        next();
      } catch (error: any) {
        logger.error("Error incrementing export usage:", error);
        // Don't block the request for usage tracking errors
        next();
      }
    };
  }

  // Utility methods
  private static hasFeatureAccess(
    userPlan: SubscriptionPlan,
    requiredPlan: SubscriptionPlan
  ): boolean {
    const planHierarchy = {
      [SubscriptionPlan.FREE]: 0,
      [SubscriptionPlan.PRO]: 1,
      [SubscriptionPlan.TEAMS]: 2,
    };

    return planHierarchy[userPlan] >= planHierarchy[requiredPlan];
  }

  // Combined middleware for routes that need multiple checks
  static checkMultipleLimits(checks: string[]) {
    return async (
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction
    ) => {
      for (const check of checks) {
        try {
          switch (check) {
            case "aiRequests":
              const aiLimitReached = await UsageTracking.hasReachedLimit(
                req.user.id,
                "aiRequests",
                req.user.plan
              );
              if (aiLimitReached) {
                return PlanEnforcementMiddleware.checkAIRequestsLimit()(
                  req,
                  res,
                  next
                );
              }
              break;
            case "exports":
              const exportLimitReached = await UsageTracking.hasReachedLimit(
                req.user.id,
                "exports",
                req.user.plan
              );
              if (exportLimitReached) {
                return PlanEnforcementMiddleware.checkExportsLimit()(
                  req,
                  res,
                  next
                );
              }
              break;
            case "storage":
              const storageLimitReached = await UsageTracking.hasReachedLimit(
                req.user.id,
                "storage",
                req.user.plan
              );
              if (storageLimitReached) {
                return PlanEnforcementMiddleware.checkStorageLimit()(
                  req,
                  res,
                  next
                );
              }
              break;
          }
        } catch (error: any) {
          logger.error(`Error checking ${check} limit:`, error);
          // Continue with other checks
        }
      }
      next();
    };
  }

  // Subscription status check
  static checkActiveSubscription() {
    return async (
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction
    ) => {
      try {
        const userId = req.user.id;
        const subscription = await Subscription.findOne({ userId });

        if (subscription && !subscription.isActive()) {
          return res.status(403).json({
            error: "Subscription inactive",
            message:
              "Your subscription is not active. Please update your payment method or renew your subscription.",
            subscription: {
              status: subscription.status,
              currentPeriodEnd: subscription.currentPeriodEnd,
            },
          });
        }

        next();
      } catch (error: any) {
        logger.error("Error checking subscription status:", error);
        res
          .status(500)
          .json({
            success: false,
            error: "Failed to check subscription status",
          });
      }
    };
  }
}

// Factory functions for specific middleware types
export const createAIEnforcementMiddleware = (
  options: { incrementUsage?: boolean } = {}
) => {
  return [PlanEnforcementMiddleware.checkAIRequestsLimit(options)];
};

export const createExportEnforcementMiddleware = (
  options: { incrementUsage?: boolean } = {}
) => {
  return [PlanEnforcementMiddleware.checkExportsLimit(options)];
};

export const createStorageEnforcementMiddleware = () => {
  return [PlanEnforcementMiddleware.checkStorageLimit()];
};

export const createFeatureEnforcementMiddleware = (
  requiredPlan: SubscriptionPlan
) => {
  return [PlanEnforcementMiddleware.checkFeatureAccess(requiredPlan)];
};

export const createFullEnforcementMiddleware = (
  options: {
    aiRequests?: boolean;
    exports?: boolean;
    storage?: boolean;
    requiredPlan?: SubscriptionPlan;
    incrementUsage?: boolean;
  } = {}
) => {
  const middleware: any[] = [];

  if (options.requiredPlan) {
    middleware.push(
      PlanEnforcementMiddleware.checkFeatureAccess(options.requiredPlan)
    );
  }

  if (options.aiRequests) {
    middleware.push(
      PlanEnforcementMiddleware.checkAIRequestsLimit({
        incrementUsage: options.incrementUsage,
      })
    );
  }

  if (options.exports) {
    middleware.push(
      PlanEnforcementMiddleware.checkExportsLimit({
        incrementUsage: options.incrementUsage,
      })
    );
  }

  if (options.storage) {
    middleware.push(PlanEnforcementMiddleware.checkStorageLimit());
  }

  return middleware;
};

