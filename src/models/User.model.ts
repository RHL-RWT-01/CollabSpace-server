import mongoose, { Document, Schema } from "mongoose";
import { SubscriptionPlan } from "../types";
import { comparePassword, hashPassword } from "../utils/password.util";

export interface IUser extends Document {
  id: string;
  email: string;
  password: string;
  name: string;
  avatar?: string;
  subscriptionPlan: SubscriptionPlan;
  razorpayCustomerId?: string;
  storageUsedBytes: number;
  lastExportAt?: Date;
  createdAt: Date;
  updatedAt: Date;

  // Instance methods
  updateStorageUsage(bytesAdded: number): Promise<void>;
  getStorageUsageGB(): number;
  hasStorageAvailable(requiredBytes: number): boolean;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: { type: String, required: true },
    avatar: { type: String },
    subscriptionPlan: {
      type: String,
      enum: Object.values(SubscriptionPlan),
      default: SubscriptionPlan.FREE,
    },
    razorpayCustomerId: { type: String },
    storageUsedBytes: { type: Number, default: 0, index: true },
    lastExportAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ subscriptionPlan: 1 });

// Hide password when converting to JSON
userSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.password;
  return user;
};

// Instance methods
userSchema.methods.updateStorageUsage = async function (
  bytesAdded: number
): Promise<void> {
  this.storageUsedBytes += bytesAdded;
  await this.save();
};

userSchema.methods.getStorageUsageGB = function (): number {
  return this.storageUsedBytes / (1024 * 1024 * 1024);
};

userSchema.methods.hasStorageAvailable = function (
  requiredBytes: number
): boolean {
  const { getPlanLimits } = require("@/utils/plan-limits.util");
  const planLimits = getPlanLimits(this.subscriptionPlan);
  const maxBytes = planLimits.storageGB * 1024 * 1024 * 1024; // Convert GB to bytes
  return this.storageUsedBytes + requiredBytes <= maxBytes;
};

// Password hashing pre-save hook
userSchema.pre<IUser>("save", async function (next: (err?: any) => void) {
  if (!this.isModified("password")) {
    return next();
  }

  try {
    this.password = await hashPassword(this.password);
    next();
  } catch (error: any) {
    next(error);
  }
});

// Password comparison method
userSchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  return comparePassword(candidatePassword, this.password);
};

export const User = mongoose.model<IUser>("User", userSchema);

