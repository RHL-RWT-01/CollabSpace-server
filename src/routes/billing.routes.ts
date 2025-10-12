import { Router } from "express";
import express from "express";
import { BillingController } from "../controllers/billing.controller";
import { authenticate } from "../middleware/auth.middleware";
import { PlanEnforcementMiddleware } from "../middleware/plan-enforcement.middleware";
import { SubscriptionPlan } from "../types";

const router = Router();

// Razorpay webhook route - MUST be BEFORE auth middleware and with JSON body parser
router.post("/webhook", express.json(), BillingController.handleWebhook);

// All other billing routes require authentication
router.use(authenticate);

// Create Razorpay subscription - matches client path
router.post(
  "/create-checkout-session",
  BillingController.createCheckoutSession
);

// Update subscription plan
router.post("/update-subscription", BillingController.updateSubscriptionPlan);

// Get subscription details from Razorpay
router.get("/subscription-details", BillingController.getSubscriptionDetails);

// Get current subscription and usage - matches client path
router.get("/subscription", BillingController.getCurrentSubscription);

// Get usage statistics
router.get("/usage", BillingController.getUsageStats);

// Cancel subscription - matches client path
router.post("/cancel-subscription", BillingController.cancelSubscription);

// Get invoices
router.get("/invoices", BillingController.getInvoices);

// Get payment methods
router.get("/payment-methods", BillingController.getPaymentMethods);

// Routes that require specific plan levels
router.get(
  "/pro-feature",
  PlanEnforcementMiddleware.checkFeatureAccess(SubscriptionPlan.PRO) as any,
  (req, res) => {
    res.json({
      success: true,
      data: { message: "Pro feature accessed successfully" },
    });
  }
);

router.get(
  "/teams-feature",
  PlanEnforcementMiddleware.checkFeatureAccess(SubscriptionPlan.TEAMS) as any,
  (req, res) => {
    res.json({
      success: true,
      data: { message: "Teams feature accessed successfully" },
    });
  }
);

// Routes with usage limits
router.post(
  "/ai-request",
  PlanEnforcementMiddleware.checkAIRequestsLimit() as any,
  PlanEnforcementMiddleware.incrementAIUsage() as any,
  (req, res) => {
    res.json({ success: true, data: { message: "AI request processed" } });
  }
);

router.post(
  "/export",
  PlanEnforcementMiddleware.checkExportsLimit() as any,
  PlanEnforcementMiddleware.incrementExportUsage() as any,
  (req, res) => {
    res.json({ success: true, data: { message: "Export created" } });
  }
);

// Collaboration features
router.get(
  "/collaboration",
  PlanEnforcementMiddleware.checkCollaborationLimit() as any,
  (req, res) => {
    res.json({
      success: true,
      data: { message: "Collaboration feature available" },
    });
  }
);

// Advanced AI features
router.get(
  "/advanced-ai",
  PlanEnforcementMiddleware.checkAdvancedAIAccess() as any,
  (req, res) => {
    res.json({
      success: true,
      data: { message: "Advanced AI features available" },
    });
  }
);

// Priority support
router.get(
  "/priority-support",
  PlanEnforcementMiddleware.checkPrioritySupportAccess() as any,
  (req, res) => {
    res.json({
      success: true,
      data: { message: "Priority support available" },
    });
  }
);

export { router as billingRoutes };
export default router;

