import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import Razorpay from "razorpay";
import { User } from "../models/User.model";
import { Subscription } from "../models/Subscription.model";
import { UsageTracking } from "../models/UsageTracking.model";
import { WebhookEvent } from "../models/WebhookEvent.model";
import { Room } from "../models/Room.model";
import { SubscriptionPlan, SubscriptionStatus } from "../types";
import { sendEmail } from "../utils/email.util";
import { logger } from "../utils/logger.util";
import { getPlanLimits } from "../utils/plan-limits.util";
import {
  isPaymentsEnabled,
  createMockResponse,
} from "../utils/feature-flags.util";
import {
  razorpay,
  RAZORPAY_PLAN_IDS,
  RAZORPAY_WEBHOOK_SECRET,
} from "../config/razorpay";
import crypto from "crypto";

export class BillingController {
  // Create Razorpay subscription
  static async createCheckoutSession(req: AuthenticatedRequest, res: Response) {
    try {
      // Check if payments are enabled
      if (!isPaymentsEnabled()) {
        return res
          .status(400)
          .json(createMockResponse("Payments", "subscription creation"));
      }

      if (!razorpay) {
        return res.status(500).json({
          success: false,
          error: "Payment service not configured",
        });
      }

      const { planId } = req.body;
      const userId = req.user!.id;

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: "User not found",
        });
      }

      let customerId = user.razorpayCustomerId;

      // Create Razorpay customer if doesn't exist
      if (!customerId) {
        const customer = await razorpay.customers.create({
          email: user.email,
          name: user.name,
          contact: (user as any).phone || "",
          notes: { userId },
        });
        customerId = customer.id;

        await User.findByIdAndUpdate(userId, {
          razorpayCustomerId: customerId,
        });
      }

      // Create subscription
      const subscription = await razorpay.subscriptions.create({
        plan_id: planId,
        customer_id: customerId,
        total_count: 12, // 12 billing cycles (1 year)
        notes: {
          userId,
        },
      } as any);

      res.json({
        success: true,
        data: {
          subscriptionId: (subscription as any).id,
          shortUrl: (subscription as any).short_url,
        },
      });
    } catch (error: any) {
      logger.error("Error creating subscription:", error);
      res.status(500).json({
        success: false,
        error: "Failed to create subscription",
      });
    }
  }

  // Get subscription details from Razorpay
  static async getSubscriptionDetails(
    req: AuthenticatedRequest,
    res: Response
  ) {
    try {
      // Check if payments are enabled
      if (!isPaymentsEnabled()) {
        return res
          .status(400)
          .json(createMockResponse("Payments", "subscription details"));
      }

      const userId = req.user!.id;
      const subscription = await Subscription.findOne({ userId });

      if (!subscription || !subscription.razorpaySubscriptionId) {
        return res.status(404).json({
          success: false,
          error: "Subscription not found",
        });
      }

      if (!razorpay) {
        return res.status(500).json({
          success: false,
          error: "Payment service not configured",
        });
      }

      const razorpaySubscription = await razorpay.subscriptions.fetch(
        subscription.razorpaySubscriptionId
      );

      res.json({
        success: true,
        data: razorpaySubscription,
      });
    } catch (error: any) {
      logger.error("Error fetching subscription details:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch subscription details",
      });
    }
  }

  // Update subscription plan
  static async updateSubscriptionPlan(
    req: AuthenticatedRequest,
    res: Response
  ) {
    try {
      // Check if payments are enabled
      if (!isPaymentsEnabled()) {
        return res
          .status(400)
          .json(createMockResponse("Payments", "subscription plan update"));
      }

      if (!razorpay) {
        return res.status(500).json({
          success: false,
          error: "Payment service not configured",
        });
      }

      const userId = req.user!.id;
      const { planId } = req.body;

      const subscription = await Subscription.findOne({ userId });
      if (!subscription || !subscription.razorpaySubscriptionId) {
        return res
          .status(404)
          .json({ success: false, error: "Subscription not found" });
      }

      // Update subscription plan in Razorpay
      const updatedSubscription = await razorpay.subscriptions.update(
        subscription.razorpaySubscriptionId,
        { plan_id: planId, schedule_change_at: "cycle_end" }
      );

      // Store pending plan change (scheduled for cycle end)
      const newPlan = BillingController.getPlanFromPlanId(planId);
      subscription.pendingPlanId = planId;
      subscription.pendingPlan = newPlan;
      subscription.planChangeEffectiveAt = subscription.currentPeriodEnd;
      await subscription.save();

      // Do not update user's effective plan until the change takes effect
      // User continues with current plan until cycle end

      res.json({
        success: true,
        data: {
          ...subscription.toObject(),
          message: `Plan change scheduled to take effect on ${subscription.currentPeriodEnd.toLocaleDateString()}`,
        },
      });
    } catch (error: any) {
      logger.error("Error updating subscription:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to update subscription" });
    }
  }

  // Get current subscription
  static async getCurrentSubscription(
    req: AuthenticatedRequest,
    res: Response
  ) {
    try {
      const userId = req.user!.id;

      const subscription = await Subscription.findOne({ userId });

      if (!subscription) {
        return res.json({
          success: true,
          data: null,
        });
      }

      // Get usage statistics
      const usage = await BillingController.getUsageStats(userId);

      res.json({
        success: true,
        data: {
          subscription,
          usage,
        },
      });
    } catch (error: any) {
      logger.error("Error getting current subscription:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get subscription",
      });
    }
  }

  // Cancel subscription
  static async cancelSubscription(req: AuthenticatedRequest, res: Response) {
    try {
      // Check if payments are enabled
      if (!isPaymentsEnabled()) {
        return res
          .status(400)
          .json(createMockResponse("Payments", "subscription cancellation"));
      }

      const userId = req.user!.id;
      const { cancelAtPeriodEnd = true } = req.body;

      const subscription = await Subscription.findOne({ userId });
      if (!subscription) {
        return res.status(404).json({
          success: false,
          error: "Subscription not found",
        });
      }

      if (!subscription.razorpaySubscriptionId) {
        return res.status(400).json({
          success: false,
          error: "No active subscription to cancel",
        });
      }

      if (!razorpay) {
        return res.status(500).json({
          success: false,
          error: "Payment service not configured",
        });
      }

      // Cancel subscription in Razorpay
      await razorpay.subscriptions.cancel(
        subscription.razorpaySubscriptionId,
        cancelAtPeriodEnd
      );

      // Update local subscription
      subscription.cancelAtPeriodEnd = cancelAtPeriodEnd;
      if (!cancelAtPeriodEnd) {
        subscription.status = SubscriptionStatus.CANCELED;
        subscription.canceledAt = new Date();
      }
      await subscription.save();

      // Update user plan if immediate cancellation
      if (!cancelAtPeriodEnd) {
        await User.findByIdAndUpdate(userId, {
          subscriptionPlan: SubscriptionPlan.FREE,
        });

        // Reconcile user limits after downgrade
        await BillingController.reconcileUserLimitsAfterDowngrade(userId);
      }

      res.json({
        success: true,
        data: subscription,
      });
    } catch (error: any) {
      logger.error("Error canceling subscription:", error);
      res.status(500).json({
        success: false,
        error: "Failed to cancel subscription",
      });
    }
  }

  // Get invoices
  static async getInvoices(req: AuthenticatedRequest, res: Response) {
    try {
      // Check if payments are enabled
      if (!isPaymentsEnabled()) {
        return res
          .status(400)
          .json(createMockResponse("Payments", "invoice retrieval"));
      }

      if (!razorpay) {
        return res.status(500).json({
          success: false,
          error: "Payment service not configured",
        });
      }

      const userId = req.user!.id;
      const subscription = await Subscription.findOne({ userId });

      if (!subscription || !subscription.razorpaySubscriptionId) {
        return res.json({ success: true, data: [] });
      }

      // Fetch invoices from Razorpay
      const invoices = await razorpay.invoices.all({
        subscription_id: subscription.razorpaySubscriptionId,
      });

      // Normalize invoice fields to ensure consistency
      const normalizedInvoices = invoices.items.map((inv: any) => ({
        id: inv.id,
        amount: inv.amount || inv.amount_paid,
        currency: inv.currency || "INR",
        status: inv.status,
        date: inv.date || inv.created_at,
        description:
          inv.description || `Subscription Payment - ${subscription.plan}`,
        receipt: inv.receipt || inv.short_url,
        invoice_pdf: inv.invoice_pdf || inv.pdf_url,
      }));

      res.json({ success: true, data: normalizedInvoices });
    } catch (error: any) {
      logger.error("Error fetching invoices:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch invoices" });
    }
  }

  // Get payment methods
  static async getPaymentMethods(req: AuthenticatedRequest, res: Response) {
    try {
      // Check if payments are enabled
      if (!isPaymentsEnabled()) {
        return res
          .status(400)
          .json(createMockResponse("Payments", "payment methods"));
      }

      const userId = req.user!.id;
      const user = await User.findById(userId);

      if (!user || !user.razorpayCustomerId) {
        return res.json({ success: true, data: [] });
      }

      if (!razorpay) {
        return res.status(500).json({
          success: false,
          error: "Payment service not configured",
        });
      }

      // Fetch tokens (saved cards) from Razorpay - using type assertion for API limitation
      const tokens = await (razorpay as any).tokens.all({
        customer_id: user.razorpayCustomerId,
      });

      res.json({ success: true, data: tokens.items });
    } catch (error: any) {
      logger.error("Error fetching payment methods:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch payment methods" });
    }
  }

  // Handle Razorpay webhooks
  static async handleWebhook(req: Request, res: Response) {
    try {
      // Check if payments are enabled
      if (!isPaymentsEnabled()) {
        logger.info("💳 Payments disabled - ignoring webhook");
        return res
          .status(200)
          .json({ received: true, message: "Payments disabled" });
      }

      const signature = req.headers["x-razorpay-signature"] as string;
      const body = JSON.stringify(req.body);

      // Verify webhook signature
      const expectedSignature = crypto
        .createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
        .update(body)
        .digest("hex");

      if (signature !== expectedSignature) {
        logger.error("Invalid webhook signature");
        return res.status(400).json({ error: "Invalid signature" });
      }

      const event = req.body;

      // Check for duplicate events using idempotency
      const existingEvent = await WebhookEvent.findOne({
        eventId:
          event.payload.subscription?.entity?.id ||
          event.payload.payment?.entity?.id,
        eventType: event.event,
      });

      if (existingEvent) {
        return res.status(200).json({ received: true });
      }

      // Store webhook event for idempotency
      await WebhookEvent.create({
        eventId:
          event.payload.subscription?.entity?.id ||
          event.payload.payment?.entity?.id,
        eventType: event.event,
        data: event,
      });

      // Handle different event types
      switch (event.event) {
        case "subscription.activated":
          await BillingController.handleSubscriptionActivated(event);
          break;
        case "subscription.charged":
          await BillingController.handleSubscriptionCharged(event);
          break;
        case "subscription.cancelled":
          await BillingController.handleSubscriptionCancelled(event);
          break;
        case "payment.failed":
          await BillingController.handlePaymentFailed(event);
          break;
        default:
          logger.info(`Unhandled webhook event: ${event.event}`);
      }

      res.status(200).json({ received: true });
    } catch (error: any) {
      logger.error("Webhook error:", error);
      res.status(400).json({ error: "Webhook handler failed" });
    }
  }

  // Handle subscription activated
  private static async handleSubscriptionActivated(event: any) {
    const subscriptionData = event.payload.subscription.entity;
    const customerId = subscriptionData.customer_id;

    // Find user by Razorpay customer ID
    const user = await User.findOne({ razorpayCustomerId: customerId });
    if (!user) {
      logger.error(`User not found for customer ID: ${customerId}`);
      return;
    }

    const plan = BillingController.getPlanFromPlanId(subscriptionData.plan_id);

    // Create or update subscription
    let subscription = await Subscription.findOne({
      razorpaySubscriptionId: subscriptionData.id,
    });

    if (!subscription) {
      subscription = new Subscription({
        userId: user._id,
        razorpaySubscriptionId: subscriptionData.id,
        razorpayCustomerId: customerId,
        razorpayPlanId: subscriptionData.plan_id,
        plan,
        status: BillingController.mapRazorpayStatus(subscriptionData.status),
        currentPeriodStart: new Date(subscriptionData.current_start * 1000),
        currentPeriodEnd: new Date(subscriptionData.current_end * 1000),
        cancelAtPeriodEnd: false,
      });
    } else {
      subscription.status = BillingController.mapRazorpayStatus(
        subscriptionData.status
      );

      // Check if this is a plan change taking effect
      if (
        subscription.pendingPlanId &&
        subscription.pendingPlanId === subscriptionData.plan_id
      ) {
        // Apply the pending plan change
        subscription.plan = subscription.pendingPlan!;
        subscription.razorpayPlanId = subscription.pendingPlanId;

        // Clear pending fields
        subscription.pendingPlanId = undefined;
        subscription.pendingPlan = undefined;
        subscription.planChangeEffectiveAt = undefined;

        // Update user's effective plan
        await User.findByIdAndUpdate(user._id, {
          subscriptionPlan: subscription.plan,
        });

        logger.info(
          `Plan change applied for user ${user._id} to ${subscription.plan}`
        );
      } else {
        subscription.plan = plan;
        subscription.razorpayPlanId = subscriptionData.plan_id;
      }

      subscription.currentPeriodStart = new Date(
        subscriptionData.current_start * 1000
      );
      subscription.currentPeriodEnd = new Date(
        subscriptionData.current_end * 1000
      );
    }

    await subscription.save();

    // Update user subscription plan only if this is not a pending change
    if (!subscription.pendingPlanId) {
      await User.findByIdAndUpdate(user._id, { subscriptionPlan: plan });
    }

    logger.info(`Subscription activated for user ${user._id}`);
  }

  // Handle subscription charged
  private static async handleSubscriptionCharged(event: any) {
    const paymentData = event.payload.payment.entity;
    const subscriptionId = paymentData.subscription_id;

    const subscription = await Subscription.findOne({
      razorpaySubscriptionId: subscriptionId,
    });
    if (!subscription) {
      logger.error(`Subscription not found: ${subscriptionId}`);
      return;
    }

    // Update subscription status to active
    subscription.status = SubscriptionStatus.ACTIVE;
    await subscription.save();

    logger.info(`Payment successful for subscription ${subscriptionId}`);
  }

  // Handle subscription cancelled
  private static async handleSubscriptionCancelled(event: any) {
    const subscriptionData = event.payload.subscription.entity;

    const subscription = await Subscription.findOne({
      razorpaySubscriptionId: subscriptionData.id,
    });
    if (!subscription) {
      logger.error(`Subscription not found: ${subscriptionData.id}`);
      return;
    }

    subscription.status = SubscriptionStatus.CANCELED;
    subscription.canceledAt = new Date();
    await subscription.save();

    // Update user to free plan
    await User.findByIdAndUpdate(subscription.userId, {
      subscriptionPlan: SubscriptionPlan.FREE,
    });

    // Reconcile user limits after downgrade
    await BillingController.reconcileUserLimitsAfterDowngrade(
      subscription.userId.toString()
    );

    logger.info(`Subscription cancelled: ${subscriptionData.id}`);
  }

  // Handle payment failed
  private static async handlePaymentFailed(event: any) {
    const paymentData = event.payload.payment.entity;
    const subscriptionId = paymentData.subscription_id;

    const subscription = await Subscription.findOne({
      razorpaySubscriptionId: subscriptionId,
    });
    if (!subscription) {
      logger.error(`Subscription not found: ${subscriptionId}`);
      return;
    }

    subscription.status = SubscriptionStatus.PAST_DUE;
    await subscription.save();

    // Send payment failed notification
    const user = await User.findById(subscription.userId);
    if (user) {
      await sendEmail({
        to: user.email,
        subject: "Payment Failed - Action Required",
        template: "payment-failed",
        data: {
          name: user.name,
          amount: paymentData.amount / 100, // Convert from paise to rupees
        },
      });
    }

    logger.info(`Payment failed for subscription ${subscriptionId}`);
  }

  // Utility method to map Razorpay plan ID to SubscriptionPlan
  static getPlanFromPlanId(planId: string): SubscriptionPlan {
    if (planId === RAZORPAY_PLAN_IDS.PRO) {
      return SubscriptionPlan.PRO;
    } else if (planId === RAZORPAY_PLAN_IDS.TEAMS) {
      return SubscriptionPlan.TEAMS;
    }
    return SubscriptionPlan.FREE;
  }

  // Utility method to map Razorpay status to SubscriptionStatus
  static mapRazorpayStatus(razorpayStatus: string): SubscriptionStatus {
    switch (razorpayStatus) {
      case "active":
      case "authenticated":
        return SubscriptionStatus.ACTIVE;
      case "cancelled":
        return SubscriptionStatus.CANCELED;
      case "expired":
      case "completed":
        return SubscriptionStatus.CANCELED;
      case "halted":
      case "paused":
        return SubscriptionStatus.PAST_DUE;
      case "pending":
        return SubscriptionStatus.PAST_DUE;
      default:
        return SubscriptionStatus.ACTIVE;
    }
  }

  // Get usage statistics
  static async getUsageStats(userId: string) {
    try {
      const user = await User.findById(userId);
      if (!user) return null;

      const limits = getPlanLimits(user.subscriptionPlan);

      // Get rooms count
      const roomsCount = await Room.countDocuments({ userId });

      // Get current month usage tracking
      const currentMonth = new Date();
      currentMonth.setDate(1);
      currentMonth.setHours(0, 0, 0, 0);

      const usageTracking = await UsageTracking.findOne({
        userId,
        month: currentMonth,
      });

      return {
        storage: {
          used: user.storageUsedBytes,
          limit: limits.storageGB * 1024 * 1024 * 1024, // Convert GB to bytes
          usedGB: user.getStorageUsageGB(),
          limitGB: limits.storageGB,
          percentage:
            (user.storageUsedBytes / (limits.storageGB * 1024 * 1024 * 1024)) *
            100,
        },
        rooms: {
          used: roomsCount,
          limit: limits.maxRooms,
          percentage: (roomsCount / limits.maxRooms) * 100,
        },
        aiCredits: {
          used: (usageTracking as any)?.aiRequestsUsed || 0,
          limit: limits.aiRequestsPerMonth,
          percentage:
            (((usageTracking as any)?.aiRequestsUsed || 0) /
              limits.aiRequestsPerMonth) *
            100,
        },
        exports: {
          used: (usageTracking as any)?.exportsUsed || 0,
          limit: limits.exportsPerMonth,
          percentage:
            (((usageTracking as any)?.exportsUsed || 0) /
              limits.exportsPerMonth) *
            100,
        },
      };
    } catch (error) {
      logger.error("Error getting usage stats:", error);
      return null;
    }
  }

  // Reconcile user limits after downgrade
  static async reconcileUserLimitsAfterDowngrade(userId: string) {
    try {
      const user = await User.findById(userId);
      if (!user) return;

      const limits = getPlanLimits(user.subscriptionPlan);

      // Check if user exceeds new limits
      const roomsCount = await Room.countDocuments({ userId });

      if (roomsCount > limits.maxRooms) {
        // Archive excess rooms
        const excessRooms = await Room.find({ userId })
          .sort({ updatedAt: 1 })
          .limit(roomsCount - limits.maxRooms);

        for (const room of excessRooms) {
          (room as any).isArchived = true;
          await room.save();
        }

        logger.info(
          `Archived ${excessRooms.length} rooms for user ${userId} due to plan downgrade`
        );
      }

      // Send downgrade notification
      await BillingController.sendDowngradeNotificationEmail(userId);
    } catch (error) {
      logger.error("Error reconciling user limits:", error);
    }
  }

  // Send downgrade notification email
  static async sendDowngradeNotificationEmail(userId: string) {
    try {
      const user = await User.findById(userId);
      if (!user) return;

      await sendEmail({
        to: user.email,
        subject: "Plan Downgrade Notification",
        template: "plan-downgrade",
        data: {
          name: user.name,
          plan: user.subscriptionPlan,
        },
      });
    } catch (error) {
      logger.error("Error sending downgrade notification:", error);
    }
  }
}

