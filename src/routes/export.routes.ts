import { Router } from "express";
import { body, query } from "express-validator";
import { Request, Response, NextFunction } from "express";
import {
  authenticate,
  AuthenticatedRequest,
} from "../middleware/auth.middleware";
import { handleValidationErrors } from "../middleware/validation.middleware";
import { checkExportLimits } from "../middleware/export-limits.middleware";
import { createExportEnforcementMiddleware } from "../middleware/plan-enforcement.middleware";
import { UsageTracker } from "../utils/usage-tracker.util";
import {
  exportAsJSON,
  exportAsPNG,
  getExportHistory,
} from "../controllers/export.controller";

const router = Router();

// Custom middleware to validate PNG file size against tier limits
const validatePNGSize = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const { imageData } = req.body;
  const user = req.user;

  if (!user) {
    res.status(401).json({ message: "User not authenticated" });
    return;
  }

  if (!imageData) {
    res.status(400).json({
      message: "Image data is required",
      error: "MISSING_IMAGE_DATA",
    });
    return;
  }

  // Calculate file size from base64 imageData
  const fileSizeBytes = Math.ceil((imageData.length * 3) / 4);
  const fileSizeMB = fileSizeBytes / (1024 * 1024);

  // Define PNG export size limits by tier (use env vars with defaults)
  const pngSizeLimits = {
    FREE: parseInt(process.env.EXPORT_PNG_SIZE_LIMIT_FREE || "10"), // 10MB default
    PRO: parseInt(process.env.EXPORT_PNG_SIZE_LIMIT_PRO || "50"), // 50MB default
    TEAMS: parseInt(process.env.EXPORT_PNG_SIZE_LIMIT_TEAMS || "50"), // 50MB default
  };

  const sizeLimit =
    pngSizeLimits[user.subscriptionPlan as keyof typeof pngSizeLimits] || 10;

  if (fileSizeMB > sizeLimit) {
    res.status(400).json({
      message: `PNG export size exceeds limit for ${user.subscriptionPlan} plan`,
      currentSize: `${fileSizeMB.toFixed(2)}MB`,
      limit: `${sizeLimit}MB`,
      error: "PNG_SIZE_LIMIT_EXCEEDED",
    });
    return;
  }

  next();
};

// Validation middleware for JSON export
const validateJSONExport = [
  body("roomId").isMongoId().withMessage("Invalid room ID"),
  body("elements")
    .optional()
    .isArray()
    .withMessage("Elements must be an array"),
  body("appState")
    .optional()
    .isObject()
    .withMessage("AppState must be an object"),
  body("files").optional().isObject().withMessage("Files must be an object"),
  handleValidationErrors,
];

// Validation middleware for PNG export
const validatePNGExport = [
  body("roomId").isMongoId().withMessage("Invalid room ID"),
  body("imageData").isLength({ min: 1 }).withMessage("Image data is required"),
  handleValidationErrors,
  validatePNGSize, // Check PNG size against tier limits
];

// Validation middleware for export history
const validateExportHistory = [
  query("roomId").optional().isMongoId().withMessage("Invalid room ID"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100"),
  query("format")
    .optional()
    .isIn(["json", "png"])
    .withMessage("Format must be json or png"),
  handleValidationErrors,
];

// POST /api/export/json
// Export whiteboard as JSON
router.post(
  "/json",
  authenticate,
  ...(createExportEnforcementMiddleware() as any), // Check limits only
  checkExportLimits,
  validateJSONExport,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      await exportAsJSON(req, res);
      // Only increment if response was successful (not an error)
      if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
        await UsageTracker.incrementExports(req.user.id);
      }
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/export/png
// Export whiteboard as PNG image
router.post(
  "/png",
  authenticate,
  ...(createExportEnforcementMiddleware() as any), // Check limits only
  checkExportLimits,
  validatePNGExport,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      await exportAsPNG(req, res);
      // Only increment if response was successful (not an error)
      if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
        await UsageTracker.incrementExports(req.user.id);
      }
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/export/history
// Get export history
router.get("/history", authenticate, validateExportHistory, getExportHistory);

export default router;

