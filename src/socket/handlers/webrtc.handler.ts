import { Socket, Server as SocketIOServer } from "socket.io";
import { createSocketRateLimiter } from "../../middleware/socketRateLimit.middleware";
import { logger } from "../../utils/logger.util";
import { getUsersInRoom, isUserInRoom } from "../../utils/presence.util";
// Rate limiters for WebRTC events
const rateLimiters = {
  iceCandidate: createSocketRateLimiter({ maxRequests: 100, windowMs: 60000 }), // 100 ICE candidates per minute
  offer: createSocketRateLimiter({ maxRequests: 10, windowMs: 60000 }), // 10 offers per minute
  answer: createSocketRateLimiter({ maxRequests: 10, windowMs: 60000 }), // 10 answers per minute
};

// Helper function to get participant limits based on subscription
const getParticipantLimit = (subscriptionPlan: string): number => {
  switch (subscriptionPlan) {
    case "FREE":
      return 2;
    case "PRO":
      return 10;
    case "TEAMS":
      return 999; // Unlimited
    default:
      return 2; // Default to free plan
  }
};

// Helper function to find target socket by userId
const findTargetSocket = async (
  io: SocketIOServer,
  roomId: string,
  targetUserId: string
): Promise<string | null> => {
  const room = io.sockets.adapter.rooms.get(roomId);
  if (!room) return null;

  for (const socketId of room) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket && socket.data.user?.id === targetUserId) {
      return socketId;
    }
  }
  return null;
};

export const registerWebRTCHandlers = (
  io: SocketIOServer,
  socket: Socket
): void => {
  // Handle WebRTC offer with rate limiting and target validation
  socket.on(
    "webrtc-offer",
    rateLimiters.offer(
      "webrtc-offer",
      async (
        socket: Socket,
        data: { roomId: string; targetUserId: string; offer: any }
      ) => {
        try {
          const { roomId, targetUserId, offer } = data;
          const senderId = socket.data.user?.id;

          if (!senderId) {
            socket.emit("error", {
              code: "UNAUTHORIZED",
              message: "Must be authenticated to send WebRTC offers",
              timestamp: new Date().toISOString(),
            });
            return;
          }

          // Validate that sender is in the room
          const isInRoom = await isUserInRoom(senderId, roomId);
          if (!isInRoom) {
            socket.emit("error", {
              code: "NOT_IN_ROOM",
              message: "Must be in room to send WebRTC offers",
              timestamp: new Date().toISOString(),
            });
            return;
          }

          // Validate that target user is in the room
          const isTargetInRoom = await isUserInRoom(targetUserId, roomId);
          if (!isTargetInRoom) {
            socket.emit("error", {
              code: "INVALID_TARGET",
              message: "Target user is not in the room",
              timestamp: new Date().toISOString(),
            });
            return;
          }

          // Find target socket
          const targetSocketId = await findTargetSocket(
            io,
            roomId,
            targetUserId
          );
          if (!targetSocketId) {
            socket.emit("error", {
              code: "USER_NOT_FOUND",
              message: "Target user not found or not connected",
              timestamp: new Date().toISOString(),
            });
            return;
          }

          // Forward offer to specific target socket
          io.to(targetSocketId).emit("webrtc-offer", {
            roomId,
            userId: senderId,
            targetUserId,
            offer,
          });

          logger.debug("WebRTC offer forwarded:", {
            from: senderId,
            to: targetUserId,
            roomId,
          });
        } catch (error) {
          logger.error("Error forwarding WebRTC offer:", error);
          socket.emit("error", {
            code: "OFFER_ERROR",
            message: "Failed to forward WebRTC offer",
            timestamp: new Date().toISOString(),
          });
        }
      }
    )
  );

  // Handle WebRTC answer with rate limiting and target validation
  socket.on(
    "webrtc-answer",
    rateLimiters.answer(
      "webrtc-answer",
      async (
        socket: Socket,
        data: { roomId: string; targetUserId: string; answer: any }
      ) => {
        try {
          const { roomId, targetUserId, answer } = data;
          const senderId = socket.data.user?.id;

          if (!senderId) {
            socket.emit("error", {
              code: "UNAUTHORIZED",
              message: "Must be authenticated to send WebRTC answers",
              timestamp: new Date().toISOString(),
            });
            return;
          }

          // Validate that sender is in the room
          const isInRoom = await isUserInRoom(senderId, roomId);
          if (!isInRoom) {
            socket.emit("error", {
              code: "NOT_IN_ROOM",
              message: "Must be in room to send WebRTC answers",
              timestamp: new Date().toISOString(),
            });
            return;
          }

          // Find target socket
          const targetSocketId = await findTargetSocket(
            io,
            roomId,
            targetUserId
          );
          if (!targetSocketId) {
            socket.emit("error", {
              code: "USER_NOT_FOUND",
              message: "Target user not found or not connected",
              timestamp: new Date().toISOString(),
            });
            return;
          }

          // Forward answer to specific target socket
          io.to(targetSocketId).emit("webrtc-answer", {
            roomId,
            userId: senderId,
            targetUserId,
            answer,
          });

          logger.debug("WebRTC answer forwarded:", {
            from: senderId,
            to: targetUserId,
            roomId,
          });
        } catch (error) {
          logger.error("Error forwarding WebRTC answer:", error);
          socket.emit("error", {
            code: "ANSWER_ERROR",
            message: "Failed to forward WebRTC answer",
            timestamp: new Date().toISOString(),
          });
        }
      }
    )
  );

  // Handle ICE candidates with rate limiting
  socket.on(
    "webrtc-ice-candidate",
    rateLimiters.iceCandidate(
      "webrtc-ice-candidate",
      async (
        socket: Socket,
        data: { roomId: string; targetUserId: string; candidate: any }
      ) => {
        try {
          const { roomId, targetUserId, candidate } = data;
          const senderId = socket.data.user?.id;

          if (!senderId) {
            return; // Silently ignore for unauthenticated users
          }

          // Find target socket
          const targetSocketId = await findTargetSocket(
            io,
            roomId,
            targetUserId
          );
          if (targetSocketId) {
            // Forward ICE candidate to specific target socket
            io.to(targetSocketId).emit("webrtc-ice-candidate", {
              roomId,
              userId: senderId,
              targetUserId,
              candidate,
            });

            logger.debug("ICE candidate forwarded:", {
              from: senderId,
              to: targetUserId,
              roomId,
            });
          }
        } catch (error) {
          logger.error("Error forwarding ICE candidate:", error);
        }
      }
    )
  );

  // Enhanced call initiation with participant limit validation
  socket.on(
    "call-user",
    async (data: { roomId: string; targetUserId?: string }) => {
      try {
        const { roomId, targetUserId } = data;
        const callerId = socket.data.user?.id;
        const callerName = socket.data.user?.name || "Anonymous";
        const subscriptionPlan = socket.data.user?.subscriptionPlan || "FREE";

        if (!callerId) {
          socket.emit("error", {
            code: "UNAUTHORIZED",
            message: "Must be authenticated to initiate calls",
            timestamp: new Date().toISOString(),
          });
          return;
        }

        // Get current participants count
        const currentUsers = await getUsersInRoom(roomId);
        const participantLimit = getParticipantLimit(subscriptionPlan);

        if (currentUsers.length >= participantLimit) {
          socket.emit("participant-limit-reached", {
            roomId,
            maxParticipants: participantLimit,
          });
          return;
        }

        // Notify all users in room that a call is starting
        if (targetUserId) {
          // Direct call to specific user
          const targetSocketId = await findTargetSocket(
            io,
            roomId,
            targetUserId
          );
          if (targetSocketId) {
            io.to(targetSocketId).emit("call-started", {
              roomId,
              callerId,
              callerName,
              targetUserId,
            });
          }
        } else {
          // Group call - notify everyone in room
          socket.to(roomId).emit("call-started", {
            roomId,
            callerId,
            callerName,
          });
        }

        logger.info("Call initiated:", {
          caller: callerId,
          target: targetUserId || "all",
          roomId,
          participantLimit,
          currentParticipants: currentUsers.length,
        });
      } catch (error) {
        logger.error("Error initiating call:", error);
        socket.emit("error", {
          code: "CALL_ERROR",
          message: "Failed to initiate call",
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // Handle call acceptance
  socket.on(
    "call-accepted",
    async (data: { roomId: string; callerId: string }) => {
      try {
        const { roomId, callerId } = data;
        const userId = socket.data.user?.id;
        const userName = socket.data.user?.name || "Anonymous";

        if (!userId) {
          return;
        }

        // Find caller socket and notify only them that call was accepted
        const callerSocketId = await findTargetSocket(io, roomId, callerId);
        if (callerSocketId) {
          io.to(callerSocketId).emit("call-accepted", {
            roomId,
            userId,
            userName,
          });
        }

        logger.info("Call accepted:", {
          acceptor: userId,
          caller: callerId,
          roomId,
        });
      } catch (error) {
        logger.error("Error handling call acceptance:", error);
      }
    }
  );

  // Handle call decline
  socket.on(
    "call-declined",
    async (data: { roomId: string; callerId: string }) => {
      try {
        const { roomId, callerId } = data;
        const userId = socket.data.user?.id;

        if (!userId) {
          return;
        }

        // Find caller socket and notify only them that call was declined
        const callerSocketId = await findTargetSocket(io, roomId, callerId);
        if (callerSocketId) {
          io.to(callerSocketId).emit("call-declined", {
            roomId,
            userId,
          });
        }

        logger.info("Call declined:", {
          decliner: userId,
          caller: callerId,
          roomId,
        });
      } catch (error) {
        logger.error("Error handling call decline:", error);
      }
    }
  );

  // Handle call termination
  socket.on("end-call", (data: { roomId: string }) => {
    try {
      // Validate input data
      if (!data) {
        socket.emit("error", {
          code: "INVALID_DATA",
          message: "Missing data for end-call request",
        });
        return;
      }

      const { roomId } = data;

      if (!roomId) {
        socket.emit("error", {
          code: "INVALID_ROOM_ID",
          message: "Room ID is required",
        });
        return;
      }

      // Notify all users in room that call ended
      socket.to(roomId).emit("call-ended", {
        roomId,
        userId: socket.data.user?.id,
      });

      logger.info("Call ended:", {
        userId: socket.data.user?.id,
        roomId,
      });
    } catch (error) {
      logger.error("Error ending call:", error);
    }
  });

  // Handle room-wide call started notification
  socket.on("room-call-started", (data: {
    roomId: string;
    callId: string;
    startedBy: {
      id: string;
      name: string;
      avatar?: string;
    };
    startedAt: string;
  }) => {
    try {
      // Validate input data
      if (!data || !data.roomId || !data.callId || !data.startedBy || !data.startedAt) {
        socket.emit("error", {
          code: "INVALID_DATA",
          message: "Missing data for room-call-started request",
        });
        return;
      }

      const { roomId, callId, startedBy, startedAt } = data;

      // Notify all other users in room about the call (excluding the starter)
      socket.to(roomId).emit("room-call-started", {
        roomId,
        callId,
        startedBy,
        startedAt,
      });

      logger.info("Room call started notification sent:", {
        callId,
        startedBy: startedBy.id,
        roomId,
      });
    } catch (error) {
      logger.error("Error handling room call started:", error);
    }
  });

  // Handle room-wide call ended notification
  socket.on("room-call-ended", (data: { roomId: string }) => {
    try {
      // Validate input data
      if (!data || !data.roomId) {
        socket.emit("error", {
          code: "INVALID_DATA",
          message: "Missing data for room-call-ended request",
        });
        return;
      }

      const { roomId } = data;

      // Notify all other users in room that call ended
      socket.to(roomId).emit("room-call-ended", {
        roomId,
      });

      logger.info("Room call ended notification sent:", {
        roomId,
      });
    } catch (error) {
      logger.error("Error handling room call ended:", error);
    }
  });

  // Handle user joining room call
  socket.on("room-call-join", (data: {
    roomId: string;
    callId: string;
    participant: {
      id: string;
      name: string;
      avatar?: string;
      isAudioMuted: boolean;
      isVideoMuted: boolean;
    };
  }) => {
    try {
      // Validate input data
      if (!data || !data.roomId || !data.callId || !data.participant) {
        socket.emit("error", {
          code: "INVALID_DATA",
          message: "Missing data for room-call-join request",
        });
        return;
      }

      const { roomId, callId, participant } = data;

      // Notify all other users in room about the new participant
      socket.to(roomId).emit("room-call-participant-joined", {
        roomId,
        callId,
        participant,
      });

      logger.info("Room call participant joined:", {
        callId,
        participantId: participant.id,
        roomId,
      });
    } catch (error) {
      logger.error("Error handling room call join:", error);
    }
  });

  // Handle user leaving room call
  socket.on("room-call-participant-left", (data: {
    roomId: string;
    participantId: string;
  }) => {
    try {
      // Validate input data
      if (!data || !data.roomId || !data.participantId) {
        socket.emit("error", {
          code: "INVALID_DATA",
          message: "Missing data for room-call-participant-left request",
        });
        return;
      }

      const { roomId, participantId } = data;

      // Notify all other users in room about the participant leaving
      socket.to(roomId).emit("room-call-participant-left", {
        roomId,
        participantId,
      });

      logger.info("Room call participant left:", {
        participantId,
        roomId,
      });
    } catch (error) {
      logger.error("Error handling room call participant left:", error);
    }
  });
};
