import { Router, Request, Response, NextFunction } from "express";
import { body } from "express-validator";
import {
  authenticate,
  AuthenticatedRequest,
} from "../middleware/auth.middleware";
import { handleValidationErrors } from "../middleware/validation.middleware";
import { aiRateLimitMiddleware } from "../middleware/ai-rate-limit.middleware";
import { createAIEnforcementMiddleware } from "../middleware/plan-enforcement.middleware";
import { UsageTracker } from "../utils/usage-tracker.util";
import {
  summarizeContent,
  generateDiagram,
} from "../controllers/ai.controller";

const router = Router();

// Validation middleware for summarize endpoint
const validateSummarize = [
  body("roomId").isMongoId().withMessage("Invalid room ID"),
  body("contentType")
    .isIn(["whiteboard", "chat", "both"])
    .withMessage("Invalid content type"),
  body("includeTimestamps")
    .optional()
    .isBoolean()
    .withMessage("includeTimestamps must be a boolean"),
  handleValidationErrors,
];

// Validation middleware for generate diagram endpoint
const validateGenerateDiagram = [
  body("roomId").isMongoId().withMessage("Invalid room ID"),
  body("prompt")
    .isLength({ min: 1, max: 1000 })
    .withMessage("Prompt must be between 1 and 1000 characters"),
  body("diagramType")
    .optional()
    .isIn(["flowchart", "mindmap", "sequence", "auto"])
    .withMessage("Invalid diagram type"),
  handleValidationErrors,
];

// POST /api/ai/summarize
// Summarize whiteboard content or chat messages
router.post(
  "/summarize",
  authenticate,
  aiRateLimitMiddleware,
  validateSummarize,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      await summarizeContent(req, res);
      // Only increment if response was successful (not an error)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        await UsageTracker.incrementAIRequests(req.user!.id);
      }
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/ai/generate-diagram
// Generate diagram from text description
router.post(
  "/generate-diagram",
  authenticate,
  aiRateLimitMiddleware,
  validateGenerateDiagram,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      await generateDiagram(req, res);
      // Only increment if response was successful (not an error)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        await UsageTracker.incrementAIRequests(req.user!.id);
      }
    } catch (error) {
      next(error);
    }
  }
);

export default router;

