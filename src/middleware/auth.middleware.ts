import { Request, Response, NextFunction } from 'express';
import { SubscriptionPlan } from '../types';
import { extractToken, verifyToken } from '../utils/jwt.util';
import { User } from '../models/User.model';
import { getSession, updateSessionActivity } from '../utils/redis.util';


// Extend Express Request interface to include user data
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    subscriptionPlan: SubscriptionPlan;
  };
  userId?: string;
  subscriptionPlan?: SubscriptionPlan;
}

// Middleware to authenticate JWT token
export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Get token from cookie or Authorization header
    const token = extractToken((req as any).headers.authorization, (req as any).cookies);

    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.',
      });
      return;
    }

    // Verify token
    const decoded = verifyToken(token);
    
    // Find user
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Invalid token. User not found.',
      });
      return;
    }

    // Check if session exists in Redis
    const session = await getSession(user.id, decoded.sessionId);
    if (!session) {
      res.status(401).json({
        success: false,
        message: 'Session expired. Please sign in again.',
      });
      return;
    }

    // Update session activity
    await updateSessionActivity(user.id, decoded.sessionId);

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      subscriptionPlan: user.subscriptionPlan,
    };
    req.userId = user.id;
    req.subscriptionPlan = user.subscriptionPlan;

    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid token.',
    });
  }
};

// Middleware to authorize based on subscription plan
export const authorize = (requiredPlan: SubscriptionPlan) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
      return;
    }

    const planHierarchy = {
      [SubscriptionPlan.FREE]: 0,
      [SubscriptionPlan.PRO]: 1,
      [SubscriptionPlan.TEAMS]: 2,
    };

    const userPlanLevel = planHierarchy[req.user.subscriptionPlan];
    const requiredPlanLevel = planHierarchy[requiredPlan];

    if (userPlanLevel < requiredPlanLevel) {
      res.status(403).json({
        success: false,
        message: `This feature requires ${requiredPlan} subscription or higher.`,
      });
      return;
    }

    next();
  };
};

// Optional authentication (doesn't fail if no token)
export const optionalAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = extractToken((req as any).headers.authorization, (req as any).cookies);
    
    if (token) {
      const decoded = verifyToken(token);
      const user = await User.findById(decoded.userId).select('-password');
      
      if (user) {
        req.user = {
          id: user.id,
          email: user.email,
          name: user.name,
          subscriptionPlan: user.subscriptionPlan,
        };
        req.userId = user.id;
        req.subscriptionPlan = user.subscriptionPlan;
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};