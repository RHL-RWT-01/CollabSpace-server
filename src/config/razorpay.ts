import Razorpay from "razorpay";
import { isPaymentsEnabled } from "../utils/feature-flags.util";

// Initialize Razorpay instance only if payments are enabled
let razorpay: Razorpay | null = null;
if (isPaymentsEnabled()) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || "",
    key_secret: process.env.RAZORPAY_KEY_SECRET || "",
  });
}

export { razorpay };

// Razorpay plan IDs from environment variables
export const RAZORPAY_PLAN_IDS = {
  PRO: process.env.RAZORPAY_PLAN_ID_PRO || "",
  TEAMS: process.env.RAZORPAY_PLAN_ID_TEAMS || "",
};

// Razorpay webhook secret for signature verification
export const RAZORPAY_WEBHOOK_SECRET =
  process.env.RAZORPAY_WEBHOOK_SECRET || "";

// Price mapping for subscription plans (in INR)
export const SUBSCRIPTION_PRICES = {
  PRO: 799, // ₹799/month
  TEAMS: 2399, // ₹2399/month
};

