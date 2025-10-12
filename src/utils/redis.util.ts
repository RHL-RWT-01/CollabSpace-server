import { redisClient } from "../config/database";
import { SubscriptionPlan } from "../types";


export interface SessionData {
  userId: string;
  sessionId: string;
  email: string;
  subscriptionPlan: SubscriptionPlan;
  loginTime: string;
  lastActivity: string;
}

/**
 * Store session data in Redis with 7-day expiration (supports multi-device)
 */
export const storeSession = async (userId: string, sessionId: string, sessionData: SessionData): Promise<void> => {
  const key = `session:${userId}:${sessionId}`;
  const sessionJson = JSON.stringify(sessionData);
  
  await redisClient.set(key, sessionJson, {
    EX: 604800, // 7 days in seconds
  });
};

/**
 * Retrieve session data from Redis by userId and sessionId
 */
export const getSession = async (userId: string, sessionId: string): Promise<SessionData | null> => {
  const key = `session:${userId}:${sessionId}`;
  const sessionJson = await redisClient.get(key);
  
  if (!sessionJson) {
    return null;
  }
  
  try {
    return JSON.parse(sessionJson) as SessionData;
  } catch (error) {
    // If JSON parsing fails, delete the corrupted session
    await redisClient.del(key);
    return null;
  }
};

/**
 * Delete specific session from Redis
 */
export const deleteSession = async (userId: string, sessionId: string): Promise<void> => {
  const key = `session:${userId}:${sessionId}`;
  await redisClient.del(key);
};

/**
 * Update session activity timestamp
 */
export const updateSessionActivity = async (userId: string, sessionId: string): Promise<void> => {
  const session = await getSession(userId, sessionId);
  
  if (session) {
    const updatedSession: SessionData = {
      ...session,
      lastActivity: new Date().toISOString(),
    };
    
    await storeSession(userId, sessionId, updatedSession);
  }
};

/**
 * Get all sessions for a user (for multi-device support)
 */
export const getAllUserSessions = async (userId: string): Promise<SessionData[]> => {
  const pattern = `session:${userId}:*`;
  const keys = await redisClient.keys(pattern);
  
  const sessions: SessionData[] = [];
  for (const key of keys) {
    const sessionJson = await redisClient.get(key);
    if (sessionJson) {
      try {
        sessions.push(JSON.parse(sessionJson) as SessionData);
      } catch (error) {
        // Delete corrupted session
        await redisClient.del(key);
      }
    }
  }
  
  return sessions;
};

/**
 * Delete all sessions for a user
 */
export const deleteAllUserSessions = async (userId: string): Promise<void> => {
  const pattern = `session:${userId}:*`;
  const keys = await redisClient.keys(pattern);
  
  if (keys.length > 0) {
    await redisClient.del(keys);
  }
};