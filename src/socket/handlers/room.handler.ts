import { Socket, Server as SocketIOServer } from "socket.io";
import { createSocketRateLimiter } from "../../middleware/socketRateLimit.middleware";
import { Room } from "../../models/Room.model";
import { User } from "../../models/User.model";
import Whiteboard from "../../models/Whiteboard.model";
import { logger } from "../../utils/logger.util";
import { canAddParticipant, getPlanLimits } from "../../utils/plan-limits.util";
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
  requestRoomUsers: createSocketRateLimiter({
    maxRequests: 30,
    windowMs: 60000,
  }),
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
            // Handle reconnection - get current users and whiteboard state
            const users = await getUsersInRoom(roomId);
            const whiteboard = await Whiteboard.findOne({ roomId });

            const whiteboardState = whiteboard
              ? {
                  elements: whiteboard.elements,
                  appState: whiteboard.appState,
                  files: whiteboard.files,
                  version: whiteboard.version,
                }
              : {
                  elements: [],
                  appState: {},
                  files: {},
                  version: 0,
                };

            socket.emit("room-joined", {
              roomId,
              users,
              whiteboardState,
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

          // Check participant limits before joining
          try {
            const room = await Room.findById(roomId);
            if (!room) {
              socket.emit("room:join-error", {
                code: "ROOM_NOT_FOUND",
                message: "Room not found",
              });
              return;
            }

            // Get room owner to check their plan limits
            const owner = await User.findById(room.ownerId);
            if (!owner) {
              socket.emit("room:join-error", {
                code: "OWNER_NOT_FOUND",
                message: "Room owner not found",
              });
              return;
            }

            // Get current participant count from both Redis presence and room participants
            const currentPresenceUsers = await getUsersInRoom(roomId);
            const currentParticipantCount = Math.max(
              currentPresenceUsers.length,
              room.participants.length
            );

            // Check if adding this user would exceed the limit
            const canAdd = canAddParticipant(
              currentParticipantCount,
              owner.subscriptionPlan
            );

            if (!canAdd.allowed) {
              const limits = getPlanLimits(owner.subscriptionPlan);
              socket.emit("room:join-error", {
                code: "PARTICIPANT_LIMIT",
                message:
                  canAdd.reason ||
                  "Participant limit reached. Room owner needs to upgrade.",
                current: currentParticipantCount,
                limit: limits.maxParticipants,
                ownerPlan: owner.subscriptionPlan,
              });
              return;
            }
          } catch (error) {
            logger.error("Error checking participant limits:", error);
            socket.emit("room:join-error", {
              code: "LIMIT_CHECK_FAILED",
              message: "Failed to verify room capacity",
            });
            return;
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

          // Load whiteboard state from database
          const whiteboard = await Whiteboard.findOne({ roomId });
          const whiteboardState = whiteboard
            ? {
                elements: whiteboard.elements,
                appState: whiteboard.appState,
                files: whiteboard.files,
                version: whiteboard.version,
              }
            : {
                elements: [],
                appState: {},
                files: {},
                version: 0,
              };

          // Notify OTHER users in room of new user with full user data including subscriptionPlan
          const fullUserData = {
            ...userPresenceData,
            subscriptionPlan: socketData.user?.subscriptionPlan,
          };

          socket.to(roomId).emit("user-joined", {
            roomId,
            user: fullUserData,
            socketId: socket.id,
            joinedAt: userPresenceData.joinedAt,
          });

          // Emit user-online event
          socket.to(roomId).emit("user-online", {
            userId,
            timestamp: new Date().toISOString(),
          });

          // Send room state to the joining user
          socket.emit("room-joined", {
            roomId,
            users: allUsers,
            whiteboardState,
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

  // Enhanced leave-room handler with Redis presence tracking
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

          if (!userId) {
            socket.emit("error", {
              code: "UNAUTHORIZED",
              message: "Must be authenticated to leave rooms",
              timestamp: new Date().toISOString(),
            });
            return;
          }

          // Verify membership
          const isInRoom = await isUserInRoom(userId, roomId);
          if (!isInRoom) {
            socket.emit("error", {
              code: "NOT_IN_ROOM",
              message: "User is not in this room",
              timestamp: new Date().toISOString(),
            });
            return;
          }

          // Remove from Redis presence
          await removeUserFromRoom(userId, roomId);

          // Leave Socket.IO room and clear current room
          socket.leave(roomId);
          socketData.currentRoom = undefined;

          // Fetch updated user list
          const users = await getUsersInRoom(roomId);

          // Notify other users in room
          socket.to(roomId).emit("user-left", {
            roomId,
            userId,
            updatedUserList: users,
          });

          // Emit user-offline event with leave reason
          socket.to(roomId).emit("user-offline", {
            userId,
            timestamp: new Date().toISOString(),
            reason: "manual",
          });

          // Confirm to the leaving user
          socket.emit("room-left", { roomId });

          logger.info(
            `User ${userId} left room ${roomId} (${users.length} remaining users)`
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

  // Enhanced user-presence handler with rate limiting and Redis activity updates
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

          if (!userId) {
            return; // Silently ignore for anonymous users
          }

          // Validate membership
          const isInRoom = await isUserInRoom(userId, roomId);
          if (!isInRoom) {
            return; // Silently ignore if not in room
          }

          // Update user activity in Redis
          await updateUserActivity(userId, roomId);

          // Broadcast presence to other users in the room
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

  // Get room users handler
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

  // Request room users handler - Allow clients to request current room users list
  socket.on(
    "request-room-users",
    rateLimiters.requestRoomUsers(
      "request-room-users",
      async (socket: Socket, data: { roomId: string }) => {
        try {
          // Validate input data
          if (!data) {
            socket.emit("error", {
              code: "INVALID_DATA",
              message: "Missing data for request-room-users request",
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

          if (!userId) {
            socket.emit("error", {
              code: "UNAUTHORIZED",
              message: "Must be authenticated to request room users",
              timestamp: new Date().toISOString(),
            });
            return;
          }

          // Validate that user is in the room
          const inRoom = await isUserInRoom(userId, roomId);
          if (!inRoom) {
            socket.emit("error", {
              code: "UNAUTHORIZED",
              message: "Must be in room to request user list",
              timestamp: new Date().toISOString(),
            });
            return;
          }

          const users = await getUsersInRoom(roomId);
          socket.emit("room-users-list", {
            roomId,
            users,
          });
        } catch (error) {
          logger.error("Error requesting room users:", error);
          socket.emit("error", {
            code: "REQUEST_ROOM_USERS_ERROR",
            message: "Failed to get room users",
            timestamp: new Date().toISOString(),
          });
        }
      }
    )
  );

  // Enhanced disconnect handler with cleanup
  socket.on("disconnect", async () => {
    try {
      const socketData = socket.data as SocketData;
      const userId = socketData.user?.id;

      if (userId && socketData.currentRoom) {
        // Remove from Redis presence
        await removeUserFromRoom(userId, socketData.currentRoom);

        // Emit offline status to room
        socket.to(socketData.currentRoom).emit("user-offline", {
          userId,
          timestamp: new Date().toISOString(),
          reason: "disconnected",
        });

        // Get updated user list
        const updatedUsers = await getUsersInRoom(socketData.currentRoom);
        socket.to(socketData.currentRoom).emit("user-left", {
          roomId: socketData.currentRoom,
          userId,
          updatedUserList: updatedUsers,
        });

        logger.info(
          `User ${userId} disconnected from room ${socketData.currentRoom}`
        );
      }
    } catch (error) {
      logger.error("Error handling disconnect:", error);
    }
  });
};

