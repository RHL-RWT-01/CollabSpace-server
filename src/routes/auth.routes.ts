import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import crypto from "crypto";
import { createRateLimit } from "../middleware/rateLimit.middleware";
import {
  validateSignin,
  validateSignup,
} from "../middleware/validation.middleware";
import { User } from "../models/User.model";
import { SubscriptionPlan } from "../types";
import {
  generateToken,
  generateSocketToken,
  verifyToken,
} from "../utils/jwt.util";
import { deleteSession, SessionData, storeSession } from "../utils/redis.util";
import { logger } from "../utils/logger.util";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

// Rate limiter for socket token endpoint (10 requests per minute)
const socketTokenRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 10,
  message: "Too many socket token requests, please try again later",
});

// Helper function for environment-aware cookie options
const getCookieOptions = () => {
  const sameSite =
    (process.env.COOKIE_SAMESITE as "none" | "lax" | "strict") ||
    (process.env.NODE_ENV === "production" ? "none" : "lax");
  const secure =
    sameSite === "none" ? true : process.env.NODE_ENV === "production";

  return {
    httpOnly: true,
    secure,
    sameSite,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    domain:
      process.env.NODE_ENV === "production"
        ? process.env.COOKIE_DOMAIN
        : undefined,
  };
};

// POST /api/auth/signup
// Register a new user
router.post("/signup", validateSignup, async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ error: "User already exists" });
    }

    // Create user
    const user = await User.create({
      email,
      password,
      name,
      subscriptionPlan: SubscriptionPlan.FREE,
    });

    // Generate session ID for multi-device support
    const sessionId = crypto.randomUUID();

    // Generate JWT token
    const token = generateToken({
      userId: (user._id as mongoose.Types.ObjectId).toString(),
      email: user.email,
      subscriptionPlan: user.subscriptionPlan,
      sessionId,
    });

    // Store session in Redis
    const sessionData: SessionData = {
      userId: (user._id as mongoose.Types.ObjectId).toString(),
      sessionId,
      email: user.email,
      subscriptionPlan: user.subscriptionPlan,
      loginTime: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    };
    await storeSession(
      (user._id as mongoose.Types.ObjectId).toString(),
      sessionId,
      sessionData
    );

    // Set httpOnly cookie with environment-aware options
    res.cookie("token", token, getCookieOptions());

    res.status(201).json({
      success: true,
      data: { user: user.toJSON() },
      message: "User registered successfully",
    });
  } catch (error: any) {
    logger.error("Signup error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// POST /api/auth/signin
// Sign in an existing user
router.post("/signin", validateSignin, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // Find user by email (include password field)
    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Compare password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Generate session ID for multi-device support
    const sessionId = crypto.randomUUID();

    // Generate JWT token
    const token = generateToken({
      userId: (user._id as mongoose.Types.ObjectId).toString(),
      email: user.email,
      subscriptionPlan: user.subscriptionPlan,
      sessionId,
    });

    // Store session in Redis
    const sessionData: SessionData = {
      userId: (user._id as mongoose.Types.ObjectId).toString(),
      sessionId,
      email: user.email,
      subscriptionPlan: user.subscriptionPlan,
      loginTime: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    };
    await storeSession(
      (user._id as mongoose.Types.ObjectId).toString(),
      sessionId,
      sessionData
    );

    // Set httpOnly cookie with environment-aware options
    res.cookie("token", token, getCookieOptions());

    res.status(200).json({
      success: true,
      data: { user: user.toJSON() },
      message: "Signed in successfully",
    });
  } catch (error: any) {
    logger.error("Signin error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// POST /api/auth/logout
// Sign out current user
router.post("/logout", authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    // Extract sessionId from token for specific session logout
    const token =
      (req as any).cookies?.token ||
      (req as any).headers.authorization?.replace("Bearer ", "");
    const decoded = verifyToken(token);

    // Delete specific session from Redis
    await deleteSession(userId, decoded.sessionId);

    // Clear cookie with matching options
    const { maxAge, ...clearOptions } = getCookieOptions();
    res.clearCookie("token", clearOptions);

    res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error: any) {
    logger.error("Logout error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// GET /api/auth/me
// Get current user profile
router.get("/me", authenticate, (req: Request, res: Response) => {
  const user = (req as any).user;

  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }

  res.status(200).json({
    success: true,
    data: { user },
  });
});

// GET /api/auth/socket-token
// Issue short-lived token for Socket.IO authentication
router.get(
  "/socket-token",
  authenticate,
  socketTokenRateLimit,
  (req: Request, res: Response) => {
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // Generate short-lived socket token with name and avatar
    const socketToken = generateSocketToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      subscriptionPlan: user.subscriptionPlan,
      sessionId: crypto.randomUUID(), // Generate new sessionId for socket
    });

    res.status(200).json({
      success: true,
      data: {
        socketToken,
        expiresIn: 300, // 5 minutes
      },
    });
  }
);

export default router;
