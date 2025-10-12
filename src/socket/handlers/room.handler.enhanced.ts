import { Socket, Server as SocketIOServer } from "socket.io";
import { createSocketRateLimiter } from "../../middleware/socketRateLimit.middleware";
import { logger } from "../../utils/logger.util";
import {
  addUserToRoom,
  getUsersInRoom,
  isUserInRoom,
  removeUserFromRoom,
  updateUserActivity,
} from "../../utils/presence.util";

interface SocketData {
  user?: {
    id: string;
    name: string;
    email?: string;
    avatar?: string;
    subscriptionPlan: string;
    isAnonymous?: boolean;
  };
  currentRoom?: string;
}

// Create rate limiters for different events
const rateLimiters = {
  joinRoom: createSocketRateLimiter({ maxRequests: 10, windowMs: 60000 }),
  leaveRoom: createSocketRateLimiter({ maxRequests: 10, windowMs: 60000 }),
  userPresence: createSocketRateLimiter({ maxRequests: 60, windowMs: 60000 }),
  getRoomUsers: createSocketRateLimiter({ maxRequests: 30, windowMs: 60000 }),
};

export const registerRoomHandlers = (
  io: SocketIOServer,
  socket: Socket
): void => {
  // Enhanced join-room handler with Redis presence tracking
  socket.on(
    "join-room",
    rateLimiters.joinRoom(
      "join-room",
      async (socket: Socket, data: { roomId: string; userData: any }) => {
        try {
          // Validate input data
          if (!data) {
            socket.emit("error", {
              code: "INVALID_DATA",
              message: "Missing data for join-room request",
              timestamp: new Date().toISOString(),
            });
            return;
          }

          const { roomId, userData } = data;

          if (!roomId) {
            socket.emit("error", {
              code: "INVALID_ROOM_ID",
              message: "Room ID is required",
              timestamp: new Date().toISOString(),
            });
            return;
          }

          const socketData = socket.data as SocketData;
          const userId = socketData.user?.id;

          if (!userId) {
            socket.emit("error", {
              code: "UNAUTHORIZED",
              message: "Must be authenticated to join rooms",
              timestamp: new Date().toISOString(),
            });
            return;
          }

          // Check if user is already in the room (reconnection case)
          const alreadyInRoom = await isUserInRoom(userId, roomId);

          if (alreadyInRoom) {
            // Handle reconnection - just emit current state
            const users = await getUsersInRoom(roomId);
            socket.emit("room-joined", {
              roomId,
              users,
              whiteboardState: {}, // Will be populated in later phases
            });

            // Broadcast socket restoration to other participants
            socket.to(roomId).emit("user-restored", {
              roomId,
              userId,
              username: socketData.user?.name || "Unknown User",
              timestamp: new Date().toISOString(),
            });

            logger.info(`User ${userId} reconnected to room ${roomId}`);
            return;
          }

          // Leave current room if any
          if (socketData.currentRoom) {
            socket.leave(socketData.currentRoom);
            await removeUserFromRoom(userId, socketData.currentRoom);

            const updatedUsers = await getUsersInRoom(socketData.currentRoom);
            socket.to(socketData.currentRoom).emit("user-left", {
              roomId: socketData.currentRoom,
              userId,
              updatedUserList: updatedUsers,
            });
          }

          // Join the Socket.IO room
          socket.join(roomId);
          socketData.currentRoom = roomId;

          // Add user to Redis presence
          const userPresenceData = {
            id: userId,
            name: socketData.user?.name || userData.userName || "Anonymous",
            avatar: socketData.user?.avatar || userData.avatar,
            socketId: socket.id,
            joinedAt: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
          };

          await addUserToRoom(userId, roomId, userPresenceData);

          // Fetch all users in room
          const allUsers = await getUsersInRoom(roomId);

          // Notify OTHER users in room of new user
          socket.to(roomId).emit("user-joined", {
            roomId,
            user: userPresenceData,
            socketId: socket.id,
            joinedAt: userPresenceData.joinedAt,
          });

          // Send room state to the joining user
          socket.emit("room-joined", {
            roomId,
            users: allUsers,
            whiteboardState: {}, // Will be populated in later phases
          });

          logger.info(
            `User ${userId} joined room ${roomId} (${allUsers.length} total users)`
          );
        } catch (error) {
          logger.error("Error joining room:", error);
          socket.emit("error", {
            code: "JOIN_ROOM_ERROR",
            message: "Failed to join room",
            timestamp: new Date().toISOString(),
          });
        }
      }
    )
  );

  // Enhanced leave-room handler
  socket.on(
    "leave-room",
    rateLimiters.leaveRoom(
      "leave-room",
      async (socket: Socket, data: { roomId: string }) => {
        try {
          // Validate input data
          if (!data) {
            socket.emit("error", {
              code: "INVALID_DATA",
              message: "Missing data for leave-room request",
              timestamp: new Date().toISOString(),
            });
            return;
          }

          const { roomId } = data;

          if (!roomId) {
            socket.emit("error", {
              code: "INVALID_ROOM_ID",
              message: "Room ID is required",
              timestamp: new Date().toISOString(),
            });
            return;
          }

          const socketData = socket.data as SocketData;
          const userId = socketData.user?.id;

          if (!userId) return;

          // Verify user is actually in the room
          const inRoom = await isUserInRoom(userId, roomId);
          if (!inRoom) {
            socket.emit("error", {
              code: "NOT_IN_ROOM",
              message: "You are not in this room",
              timestamp: new Date().toISOString(),
            });
            return;
          }

          // Remove from Socket.IO room
          socket.leave(roomId);
          socketData.currentRoom = undefined;

          // Remove from Redis presence
          await removeUserFromRoom(userId, roomId);

          // Fetch updated user list
          const updatedUsers = await getUsersInRoom(roomId);

          // Notify remaining users
          socket.to(roomId).emit("user-left", {
            roomId,
            userId,
            updatedUserList: updatedUsers,
          });

          // Confirm to leaving user
          socket.emit("room-left", { roomId });

          logger.info(
            `User ${userId} left room ${roomId} (${updatedUsers.length} remaining users)`
          );
        } catch (error) {
          logger.error("Error leaving room:", error);
          socket.emit("error", {
            code: "LEAVE_ROOM_ERROR",
            message: "Failed to leave room",
            timestamp: new Date().toISOString(),
          });
        }
      }
    )
  );

  // Enhanced user presence handler with throttling
  socket.on(
    "user-presence",
    rateLimiters.userPresence(
      "user-presence",
      async (socket: Socket, data: { roomId: string; presence: any }) => {
        try {
          // Validate input data
          if (!data) {
            return; // Silently ignore invalid data for presence updates
          }

          const { roomId, presence } = data;

          if (!roomId) {
            return; // Silently ignore if no room ID
          }

          const socketData = socket.data as SocketData;
          const userId = socketData.user?.id;

          if (!userId) return;

          // Validate that user is in the room
          const inRoom = await isUserInRoom(userId, roomId);
          if (!inRoom) return;

          // Update user activity in Redis
          await updateUserActivity(userId, roomId);

          // Broadcast presence update to other users
          socket.to(roomId).emit("user-presence", {
            roomId,
            userId,
            presence,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          logger.error("Error updating user presence:", error);
        }
      }
    )
  );

  // New handler for get-room-users
  socket.on(
    "get-room-users",
    rateLimiters.getRoomUsers(
      "get-room-users",
      async (socket: Socket, data: { roomId: string }) => {
        try {
          const { roomId } = data;
          const users = await getUsersInRoom(roomId);

          socket.emit("room-users", {
            roomId,
            users,
          });
        } catch (error) {
          logger.error("Error getting room users:", error);
          socket.emit("error", {
            code: "GET_ROOM_USERS_ERROR",
            message: "Failed to get room users",
            timestamp: new Date().toISOString(),
          });
        }
      }
    )
  );
};

