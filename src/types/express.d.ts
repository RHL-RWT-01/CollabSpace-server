import { Request } from 'express';
import { SubscriptionPlan } from './index';

// Extend Express Request interface to include user data
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        subscriptionPlan: SubscriptionPlan;
      };
      userId?: string;
      subscriptionPlan?: SubscriptionPlan;
    }
  }
}