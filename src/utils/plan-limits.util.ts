import { SubscriptionPlan } from '../types';

export interface PlanLimits {
  aiRequestsPerMonth: number; // -1 for unlimited
  exportsPerMonth: number; // -1 for unlimited
  storageGB: number; // -1 for unlimited
  maxRooms: number; // -1 for unlimited
  maxParticipants: number; // -1 for unlimited
  collaboration: boolean;
  advancedAI: boolean;
  prioritySupport: boolean;
  customBranding: boolean;
  apiAccess: boolean;
  exportRetentionDays: number;
}

const PLAN_LIMITS: Record<SubscriptionPlan, PlanLimits> = {
  [SubscriptionPlan.FREE]: {
    aiRequestsPerMonth: parseInt(process.env.FREE_AI_REQUESTS_LIMIT || '50'),
    exportsPerMonth: parseInt(process.env.FREE_EXPORTS_LIMIT || '5'),
    storageGB: parseInt(process.env.FREE_STORAGE_LIMIT_GB || '1'),
    maxRooms: parseInt(process.env.FREE_MAX_ROOMS || '3'),
    maxParticipants: parseInt(process.env.FREE_MAX_PARTICIPANTS || '2'),
    collaboration: false,
    advancedAI: false,
    prioritySupport: false,
    customBranding: false,
    apiAccess: false,
    exportRetentionDays: parseInt(
      process.env.FREE_EXPORT_RETENTION_DAYS || '7'
    ),
  },
  [SubscriptionPlan.PRO]: {
    aiRequestsPerMonth: parseInt(process.env.PRO_AI_REQUESTS_LIMIT || '1000'),
    exportsPerMonth: parseInt(process.env.PRO_EXPORTS_LIMIT || '100'),
    storageGB: parseInt(process.env.PRO_STORAGE_LIMIT_GB || '50'),
    maxRooms: parseInt(process.env.PRO_MAX_ROOMS || '50'),
    maxParticipants: parseInt(process.env.PRO_MAX_PARTICIPANTS || '10'),
    collaboration: true,
    advancedAI: true,
    prioritySupport: false,
    customBranding: false,
    apiAccess: true,
    exportRetentionDays: parseInt(
      process.env.PRO_EXPORT_RETENTION_DAYS || '30'
    ),
  },
  [SubscriptionPlan.TEAMS]: {
    aiRequestsPerMonth: -1, // Unlimited
    exportsPerMonth: -1, // Unlimited
    storageGB: parseInt(process.env.TEAMS_STORAGE_LIMIT_GB || '500'),
    maxRooms: -1, // Unlimited
    maxParticipants: parseInt(process.env.TEAMS_MAX_PARTICIPANTS || '50'),
    collaboration: true,
    advancedAI: true,
    prioritySupport: true,
    customBranding: true,
    apiAccess: true,
    exportRetentionDays: parseInt(
      process.env.TEAMS_EXPORT_RETENTION_DAYS || '365'
    ),
  },
};

export function getPlanLimits(plan: SubscriptionPlan): PlanLimits {
  return PLAN_LIMITS[plan] || PLAN_LIMITS[SubscriptionPlan.FREE];
}

export function isFeatureAvailable(
  plan: SubscriptionPlan,
  feature: keyof PlanLimits
): boolean {
  const limits = getPlanLimits(plan);
  const value = limits[feature];

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  return false;
}

export function canExceedLimit(
  plan: SubscriptionPlan,
  limitType:
    | 'aiRequestsPerMonth'
    | 'exportsPerMonth'
    | 'storageGB'
    | 'maxRooms'
    | 'maxParticipants'
): boolean {
  const limits = getPlanLimits(plan);
  return limits[limitType] === -1;
}

export function getRemainingUsage(
  currentUsage: number,
  plan: SubscriptionPlan,
  limitType:
    | 'aiRequestsPerMonth'
    | 'exportsPerMonth'
    | 'storageGB'
    | 'maxRooms'
    | 'maxParticipants'
): number | 'unlimited' {
  const limits = getPlanLimits(plan);
  const limit = limits[limitType];

  if (limit === -1) {
    return 'unlimited';
  }

  return Math.max(0, limit - currentUsage);
}

export function getUsagePercentage(
  currentUsage: number,
  plan: SubscriptionPlan,
  limitType:
    | 'aiRequestsPerMonth'
    | 'exportsPerMonth'
    | 'storageGB'
    | 'maxRooms'
    | 'maxParticipants'
): number {
  const limits = getPlanLimits(plan);
  const limit = limits[limitType];

  if (limit === -1) {
    return 0; // Unlimited
  }

  return Math.min(100, (currentUsage / limit) * 100);
}

export function isPlanUpgradeRequired(
  currentPlan: SubscriptionPlan,
  requiredFeature: keyof PlanLimits
): boolean {
  return !isFeatureAvailable(currentPlan, requiredFeature);
}

export function getNextUpgradePlan(
  currentPlan: SubscriptionPlan
): SubscriptionPlan | null {
  switch (currentPlan) {
    case SubscriptionPlan.FREE:
      return SubscriptionPlan.PRO;
    case SubscriptionPlan.PRO:
      return SubscriptionPlan.TEAMS;
    case SubscriptionPlan.TEAMS:
      return null; // Already at highest plan
    default:
      return SubscriptionPlan.PRO;
  }
}

export function formatStorageSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${Math.round(size * 100) / 100} ${units[unitIndex]}`;
}

export function formatUsageStats(usage: any, plan: SubscriptionPlan) {
  const limits = getPlanLimits(plan);

  return {
    aiRequests: {
      current: usage.aiRequestsCount || 0,
      limit:
        limits.aiRequestsPerMonth === -1
          ? 'unlimited'
          : limits.aiRequestsPerMonth,
      percentage: getUsagePercentage(
        usage.aiRequestsCount || 0,
        plan,
        'aiRequestsPerMonth'
      ),
      remaining: getRemainingUsage(
        usage.aiRequestsCount || 0,
        plan,
        'aiRequestsPerMonth'
      ),
    },
    exports: {
      current: usage.exportsCount || 0,
      limit:
        limits.exportsPerMonth === -1 ? 'unlimited' : limits.exportsPerMonth,
      percentage: getUsagePercentage(
        usage.exportsCount || 0,
        plan,
        'exportsPerMonth'
      ),
      remaining: getRemainingUsage(
        usage.exportsCount || 0,
        plan,
        'exportsPerMonth'
      ),
    },
    storage: {
      current: formatStorageSize(usage.storageUsedBytes || 0),
      currentBytes: usage.storageUsedBytes || 0,
      limit: limits.storageGB === -1 ? 'unlimited' : `${limits.storageGB} GB`,
      limitBytes:
        limits.storageGB === -1 ? -1 : limits.storageGB * 1024 * 1024 * 1024,
      percentage: getUsagePercentage(
        (usage.storageUsedBytes || 0) / (1024 * 1024 * 1024),
        plan,
        'storageGB'
      ),
      remaining:
        limits.storageGB === -1
          ? 'unlimited'
          : formatStorageSize(
              Math.max(
                0,
                limits.storageGB * 1024 * 1024 * 1024 -
                  (usage.storageUsedBytes || 0)
              )
            ),
    },
  };
}

export function getPlanDisplayName(plan: SubscriptionPlan): string {
  switch (plan) {
    case SubscriptionPlan.FREE:
      return 'Free';
    case SubscriptionPlan.PRO:
      return 'Pro';
    case SubscriptionPlan.TEAMS:
      return 'Teams';
    default:
      return 'Unknown';
  }
}

export function getPlanPricing(): Record<
  SubscriptionPlan,
  { monthly: number; yearly: number; description: string }
> {
  return {
    [SubscriptionPlan.FREE]: {
      monthly: 0,
      yearly: 0,
      description: 'Perfect for getting started',
    },
    [SubscriptionPlan.PRO]: {
      monthly: 19,
      yearly: 190, // ~$15.83/month
      description: 'For professionals and small teams',
    },
    [SubscriptionPlan.TEAMS]: {
      monthly: 99,
      yearly: 990, // ~$82.50/month
      description: 'For large teams and organizations',
    },
  };
}

// Legacy compatibility functions - can be removed if not used elsewhere
export const canCreateRoom = async (
  userId: string,
  plan: SubscriptionPlan
): Promise<{ allowed: boolean; reason?: string }> => {
  const limits = getPlanLimits(plan);

  // Unlimited rooms for higher plans
  if (limits.maxRooms === -1) {
    return { allowed: true };
  }

  try {
    // Import Room model dynamically to avoid circular dependencies
    const { Room } = await import('../models/Room.model');
    const currentRoomCount = await Room.countDocuments({ ownerId: userId });

    if (currentRoomCount >= limits.maxRooms) {
      return {
        allowed: false,
        reason: `Room limit reached for ${plan} plan`,
      };
    }

    return { allowed: true };
  } catch (error) {
    // If we can't check room count, allow creation for now
    return { allowed: true };
  }
};

export const canAddParticipant = (
  currentCount: number,
  plan: SubscriptionPlan
): { allowed: boolean; reason?: string } => {
  const limits = getPlanLimits(plan);

  // Unlimited participants for higher plans
  if (limits.maxParticipants === -1) {
    return { allowed: true };
  }

  if (currentCount >= limits.maxParticipants) {
    return {
      allowed: false,
      reason: `Participant limit reached for ${plan} plan`,
    };
  }

  return { allowed: true };
};
