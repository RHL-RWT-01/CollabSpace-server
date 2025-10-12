import { Schema, model, Document, Types, Model } from "mongoose";
import { SubscriptionPlan } from "../types";
import { getPlanLimits } from "../utils/plan-limits.util";

export interface IUsageTracking extends Document {
  userId: Types.ObjectId;
  month: string; // Format: 'YYYY-MM'
  aiRequestsCount: number;
  roomsCreatedCount: number;
  exportsCount: number;
  storageUsedBytes: number;
  lastResetAt: Date;
  createdAt: Date;
  updatedAt: Date;

  // Instance methods
  getRemainingAIRequests(plan: SubscriptionPlan): number;
  getRemainingStorage(plan: SubscriptionPlan): number;
  getUsagePercentage(limitType: string, plan: SubscriptionPlan): number;
}

export interface IUsageTrackingModel extends Model<IUsageTracking> {
  getCurrentUsage(userId: string): Promise<IUsageTracking>;
  incrementAIRequests(userId: string): Promise<IUsageTracking>;
  incrementExports(userId: string): Promise<IUsageTracking>;
  updateStorage(userId: string, bytes: number): Promise<IUsageTracking>;
  resetMonthlyCounters(userId: string): Promise<IUsageTracking>;
  hasReachedLimit(
    userId: string,
    limitType: string,
    plan: SubscriptionPlan
  ): Promise<boolean>;
}

const usageTrackingSchema = new Schema<IUsageTracking>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    month: {
      type: String,
      required: true,
      index: true,
      match: /^\d{4}-\d{2}$/, // YYYY-MM format
    },
    aiRequestsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    roomsCreatedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    exportsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    storageUsedBytes: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastResetAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient queries
usageTrackingSchema.index({ userId: 1, month: 1 }, { unique: true });

// Static methods
usageTrackingSchema.statics.getCurrentUsage = async function (userId: string) {
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

  let usage = await this.findOne({ userId, month: currentMonth });

  if (!usage) {
    usage = new this({
      userId,
      month: currentMonth,
      aiRequestsCount: 0,
      roomsCreatedCount: 0,
      exportsCount: 0,
      storageUsedBytes: 0,
    });
    await usage.save();
  }

  return usage;
};

usageTrackingSchema.statics.incrementAIRequests = async function (
  userId: string
) {
  const currentMonth = new Date().toISOString().slice(0, 7);

  return this.findOneAndUpdate(
    { userId, month: currentMonth },
    {
      $inc: { aiRequestsCount: 1 },
      $setOnInsert: {
        userId,
        month: currentMonth,
        roomsCreatedCount: 0,
        exportsCount: 0,
        storageUsedBytes: 0,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );
};

usageTrackingSchema.statics.incrementExports = async function (userId: string) {
  const currentMonth = new Date().toISOString().slice(0, 7);

  return this.findOneAndUpdate(
    { userId, month: currentMonth },
    {
      $inc: { exportsCount: 1 },
      $setOnInsert: {
        userId,
        month: currentMonth,
        aiRequestsCount: 0,
        roomsCreatedCount: 0,
        storageUsedBytes: 0,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );
};

usageTrackingSchema.statics.updateStorage = async function (
  userId: string,
  bytes: number
) {
  const currentMonth = new Date().toISOString().slice(0, 7);

  return this.findOneAndUpdate(
    { userId, month: currentMonth },
    {
      storageUsedBytes: bytes,
      $setOnInsert: {
        userId,
        month: currentMonth,
        aiRequestsCount: 0,
        roomsCreatedCount: 0,
        exportsCount: 0,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );
};

usageTrackingSchema.statics.resetMonthlyCounters = async function (
  userId: string
) {
  const currentMonth = new Date().toISOString().slice(0, 7);

  return this.findOneAndUpdate(
    { userId, month: currentMonth },
    {
      aiRequestsCount: 0,
      roomsCreatedCount: 0,
      exportsCount: 0,
      lastResetAt: new Date(),
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );
};

usageTrackingSchema.statics.hasReachedLimit = async function (
  userId: string,
  limitType: string,
  plan: SubscriptionPlan
) {
  const usage = await (this as IUsageTrackingModel).getCurrentUsage(userId);
  const limits = getPlanLimits(plan);

  switch (limitType) {
    case "aiRequests":
      return (
        limits.aiRequestsPerMonth > 0 &&
        usage.aiRequestsCount >= limits.aiRequestsPerMonth
      );
    case "exports":
      return (
        limits.exportsPerMonth > 0 &&
        usage.exportsCount >= limits.exportsPerMonth
      );
    case "storage":
      const storageLimit = limits.storageGB * 1024 * 1024 * 1024; // Convert GB to bytes
      return limits.storageGB > 0 && usage.storageUsedBytes >= storageLimit;
    default:
      return false;
  }
};

// Instance methods
usageTrackingSchema.methods.getRemainingAIRequests = function (
  plan: SubscriptionPlan
) {
  const limits = getPlanLimits(plan);
  if (limits.aiRequestsPerMonth === -1) return -1; // Unlimited
  return Math.max(0, limits.aiRequestsPerMonth - this.aiRequestsCount);
};

usageTrackingSchema.methods.getRemainingStorage = function (
  plan: SubscriptionPlan
) {
  const limits = getPlanLimits(plan);
  if (limits.storageGB === -1) return -1; // Unlimited
  const storageLimit = limits.storageGB * 1024 * 1024 * 1024; // Convert GB to bytes
  return Math.max(0, storageLimit - this.storageUsedBytes);
};

usageTrackingSchema.methods.getUsagePercentage = function (
  limitType: string,
  plan: SubscriptionPlan
) {
  const limits = getPlanLimits(plan);

  switch (limitType) {
    case "aiRequests":
      if (limits.aiRequestsPerMonth === -1) return 0; // Unlimited
      return (this.aiRequestsCount / limits.aiRequestsPerMonth) * 100;
    case "exports":
      if (limits.exportsPerMonth === -1) return 0; // Unlimited
      return (this.exportsCount / limits.exportsPerMonth) * 100;
    case "storage":
      if (limits.storageGB === -1) return 0; // Unlimited
      const storageLimit = limits.storageGB * 1024 * 1024 * 1024;
      return (this.storageUsedBytes / storageLimit) * 100;
    default:
      return 0;
  }
};

// Pre-save validation
usageTrackingSchema.pre("save", function (next) {
  // Ensure all counts are non-negative
  if (
    this.aiRequestsCount < 0 ||
    this.roomsCreatedCount < 0 ||
    this.exportsCount < 0 ||
    this.storageUsedBytes < 0
  ) {
    return next(new Error("Usage counts cannot be negative"));
  }

  // Validate month format
  if (!/^\d{4}-\d{2}$/.test(this.month)) {
    return next(new Error("Month must be in YYYY-MM format"));
  }

  next();
});

export const UsageTracking = model<IUsageTracking, IUsageTrackingModel>(
  "UsageTracking",
  usageTrackingSchema
);

