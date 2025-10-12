import { redisClient } from "../config/database";
import { logger } from "./logger.util";


export interface UserPresenceData {
  id: string;
  name: string;
  avatar?: string;
  socketId: string;
  joinedAt: string;
  lastActivity: string;
}

/**
 * Add user to room presence set in Redis with user metadata
 */
export const addUserToRoom = async (userId: string, roomId: string, userData: UserPresenceData): Promise<void> => {
  try {
    const key = `room:${roomId}:users`;
    const userDataString = JSON.stringify(userData);
    
    await redisClient.hSet(key, userId, userDataString);
    await redisClient.expire(key, 24 * 60 * 60); // 24 hours
    
    logger.info(`User ${userId} added to room ${roomId}`);
  } catch (error) {
    logger.error("Error adding user to room:", error);
  }
};

/**
 * Remove user from room presence hash
 */
export const removeUserFromRoom = async (userId: string, roomId: string): Promise<void> => {
  try {
    const key = `room:${roomId}:users`;
    await redisClient.hDel(key, userId);
    
    // Check if hash is empty and delete if so
    const remainingUsers = await redisClient.hLen(key);
    if (remainingUsers === 0) {
      await redisClient.del(key);
    }
    
    logger.info(`User ${userId} removed from room ${roomId}`);
  } catch (error) {
    logger.error('Error removing user from room:', error);
  }
};

/**
 * Retrieve all users currently in a room
 */
export const getUsersInRoom = async (roomId: string): Promise<UserPresenceData[]> => {
  try {
    const key = `room:${roomId}:users`;
    const usersData = await redisClient.hGetAll(key) as Record<string, string>;
    
    const users: UserPresenceData[] = [];
    for (const [userId, userData] of Object.entries(usersData)) {
      try {
        const parsedUser = JSON.parse(userData as string) as UserPresenceData;
        users.push({ ...parsedUser, id: userId });
      } catch (parseError) {
        logger.error(`Error parsing user data for ${userId}:`, parseError);
      }
    }
    
    return users;
  } catch (error) {
    logger.error('Error getting users in room:', error);
    return [];
  }
};

/**
 * Update the socketId for a user in a specific room
 */
export const setUserSocketId = async (userId: string, roomId: string, socketId: string): Promise<void> => {
  try {
    const key = `room:${roomId}:users`;
    const existingData = await redisClient.hGet(key, userId);
    
    if (existingData) {
      const userData = JSON.parse(existingData) as UserPresenceData;
      userData.socketId = socketId;
      userData.lastActivity = new Date().toISOString();
      
      await redisClient.hSet(key, userId, JSON.stringify(userData));
      logger.info(`Socket ID updated for user ${userId} in room ${roomId}`);
    }
  } catch (error) {
    logger.error('Error setting user socket ID:', error);
  }
};

/**
 * Get all rooms a user is currently in
 */
export const getUserRooms = async (userId: string): Promise<string[]> => {
  try {
    const pattern = 'room:*:users';
    const keys = await redisClient.keys(pattern);
    
    const userRooms: string[] = [];
    for (const key of keys) {
      const exists = await redisClient.hExists(key, userId);
      if (exists) {
        // Extract roomId from key pattern room:${roomId}:users
        const roomId = key.split(':')[1];
        userRooms.push(roomId);
      }
    }
    
    return userRooms;
  } catch (error) {
    logger.error('Error getting user rooms:', error);
    return [];
  }
};

/**
 * Remove user from all rooms when they disconnect
 */
export const cleanupUserPresence = async (userId: string, socketId?: string): Promise<string[]> => {
  try {
    const userRooms = await getUserRooms(userId);
    
    for (const roomId of userRooms) {
      // Optionally check if socketId matches before removal
      if (socketId) {
        const key = `room:${roomId}:users`;
        const existingData = await redisClient.hGet(key, userId);
        if (existingData) {
          const userData = JSON.parse(existingData as string) as UserPresenceData;
          // Only remove if this is the matching socket
          if (userData.socketId === socketId) {
            await removeUserFromRoom(userId, roomId);
          }
        }
      } else {
        // Remove from all rooms if no socketId check needed
        await removeUserFromRoom(userId, roomId);
      }
    }
    
    logger.info(`Cleaned up presence for user ${userId} from ${userRooms.length} rooms`);
    return userRooms;
  } catch (error) {
    logger.error('Error cleaning up user presence:', error);
    return [];
  }
};

/**
 * Check if user exists in room presence hash
 */
export const isUserInRoom = async (userId: string, roomId: string): Promise<boolean> => {
  try {
    const key = `room:${roomId}:users`;
    return await redisClient.hExists(key, userId);
  } catch (error) {
    logger.error('Error checking if user in room:', error);
    return false;
  }
};

/**
 * Update lastActivity timestamp for user in room
 */
export const updateUserActivity = async (userId: string, roomId: string): Promise<void> => {
  try {
    const key = `room:${roomId}:users`;
    const existingData = await redisClient.hGet(key, userId);
    
    if (existingData) {
      const userData = JSON.parse(existingData) as UserPresenceData;
      userData.lastActivity = new Date().toISOString();
      
      await redisClient.hSet(key, userId, JSON.stringify(userData));
    }
  } catch (error) {
    logger.error('Error updating user activity:', error);
  }
};