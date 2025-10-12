import { Schema, model, Document, Types } from "mongoose";
import { SubscriptionPlan, SubscriptionStatus } from "../types";

export interface ISubscription extends Document {
  userId: Types.ObjectId;
  razorpaySubscriptionId: string;
  razorpayCustomerId: string;
  razorpayPlanId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt?: Date;
  trialStart?: Date;
  trialEnd?: Date;
  pendingPlanId?: string;
  pendingPlan?: SubscriptionPlan;
  planChangeEffectiveAt?: Date;
  metadata: any;
  createdAt: Date;
  updatedAt: Date;

  // Instance methods
  daysUntilRenewal(): number;
  isActive(): boolean;
}

const subscriptionSchema = new Schema<ISubscription>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    razorpaySubscriptionId: {
      type: String,
      unique: true,
      required: true,
      index: true,
    },
    razorpayCustomerId: {
      type: String,
      required: true,
      index: true,
    },
    razorpayPlanId: {
      type: String,
      required: true,
    },
    plan: {
      type: String,
      enum: Object.values(SubscriptionPlan),
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(SubscriptionStatus),
      default: SubscriptionStatus.ACTIVE,
    },
    currentPeriodStart: {
      type: Date,
      required: true,
    },
    currentPeriodEnd: {
      type: Date,
      required: true,
      index: true,
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },
    canceledAt: {
      type: Date,
      optional: true,
    },
    trialStart: {
      type: Date,
      optional: true,
    },
    trialEnd: {
      type: Date,
      optional: true,
    },
    pendingPlanId: {
      type: String,
      optional: true,
    },
    pendingPlan: {
      type: String,
      enum: Object.values(SubscriptionPlan),
      optional: true,
    },
    planChangeEffectiveAt: {
      type: Date,
      optional: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
subscriptionSchema.index({ userId: 1, status: 1 });
subscriptionSchema.index({ razorpaySubscriptionId: 1 });
subscriptionSchema.index({ razorpayCustomerId: 1 });
subscriptionSchema.index({ currentPeriodEnd: 1 });

// Static methods
subscriptionSchema.statics.findByUserId = async function (userId: string) {
  return this.findOne({
    userId,
    status: { $in: ["active", "trialing"] },
  }).sort({ createdAt: -1 });
};

subscriptionSchema.statics.findByRazorpaySubscriptionId = async function (
  subscriptionId: string
) {
  return this.findOne({ razorpaySubscriptionId: subscriptionId });
};

subscriptionSchema.statics.isActive = function (subscription: ISubscription) {
  return subscription && ["active", "trialing"].includes(subscription.status);
};

subscriptionSchema.statics.hasExpired = function (subscription: ISubscription) {
  return subscription && new Date() > subscription.currentPeriodEnd;
};

// Instance methods
subscriptionSchema.methods.isActive = function (): boolean {
  return (
    this.status === SubscriptionStatus.ACTIVE ||
    this.status === SubscriptionStatus.TRIALING
  );
};

subscriptionSchema.methods.daysUntilRenewal = function () {
  const now = new Date();
  const renewal = new Date(this.currentPeriodEnd);
  const diffTime = renewal.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

subscriptionSchema.methods.canDowngrade = function () {
  // Can downgrade if not already FREE and not in trial
  return this.plan !== SubscriptionPlan.FREE && this.status !== "trialing";
};

// Pre-save hook
subscriptionSchema.pre("save", function (next) {
  // Validate period dates
  if (this.currentPeriodStart >= this.currentPeriodEnd) {
    return next(new Error("Current period start must be before end"));
  }

  // Validate status transitions
  const validTransitions: Record<SubscriptionStatus, SubscriptionStatus[]> = {
    [SubscriptionStatus.TRIALING]: [
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.CANCELED,
      SubscriptionStatus.PAST_DUE,
    ],
    [SubscriptionStatus.ACTIVE]: [
      SubscriptionStatus.CANCELED,
      SubscriptionStatus.PAST_DUE,
      SubscriptionStatus.UNPAID,
    ],
    [SubscriptionStatus.PAST_DUE]: [
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.CANCELED,
      SubscriptionStatus.UNPAID,
    ],
    [SubscriptionStatus.UNPAID]: [
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.CANCELED,
    ],
    [SubscriptionStatus.CANCELED]: [SubscriptionStatus.ACTIVE], // Can reactivate
  };

  if (this.isModified("status") && this.isNew === false) {
    const currentStatus = this.get("status");
    // Skip validation for status transitions during updates
    // This can be enhanced later with proper original value tracking

    // For now, just validate that the status is a valid enum value
    if (!Object.values(SubscriptionStatus).includes(currentStatus)) {
      return next(new Error(`Invalid status: ${currentStatus}`));
    }
  }

  next();
});

export const Subscription = model<ISubscription>(
  "Subscription",
  subscriptionSchema
);

