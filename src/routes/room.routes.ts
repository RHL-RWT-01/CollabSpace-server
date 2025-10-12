import { Router, Request, Response } from "express";
import {
  authenticate,
  AuthenticatedRequest,
  optionalAuth,
} from "../middleware/auth.middleware";

// Extend the AuthenticatedRequest to include Express properties
interface ExtendedAuthenticatedRequest extends AuthenticatedRequest {
  params: any;
  body: any;
  query: any;
  room?: any;
}
import {
  checkRoomOwnership,
  checkRoomParticipation,
  checkRoomAccess,
} from "../middleware/room-access.middleware";
import {
  validateObjectId,
  validateCreateRoom,
  validateUpdateRoom,
} from "../middleware/validation.middleware";
import {
  canCreateRoom,
  canAddParticipant,
  getPlanLimits,
} from "../utils/plan-limits.util";
import { createFeatureEnforcementMiddleware } from "../middleware/plan-enforcement.middleware";
import { Room } from "../models/Room.model";
import { User } from "../models/User.model";
import WhiteboardModel from "../models/Whiteboard.model";
import { Message } from "../models/Message.model";
import { getUsersInRoom, removeUserFromRoom } from "../utils/presence.util";
import { logger } from "../utils/logger.util";
import { getSocketIO } from "../socket/index";
import { SubscriptionPlan, APIResponse } from "../types";

const router = Router();

// GET /api/rooms - List user's rooms (owned + participated)
router.get(
  "/",
  authenticate,
  async (req: ExtendedAuthenticatedRequest, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;

      // Parse filter parameter with validation
      let filter = req.query.filter as string;
      if (!filter || !["owned", "joined", "all"].includes(filter)) {
        filter = "all";
      }

      // Build base filter based on filter parameter
      const baseFilter =
        filter === "owned"
          ? { ownerId: req.user!.id }
          : filter === "joined"
            ? { participants: req.user!.id }
            : {
                $or: [
                  { ownerId: req.user!.id },
                  { participants: req.user!.id },
                ],
              };

      // Get total count
      const totalRooms = await Room.countDocuments(baseFilter);

      const rooms = await Room.find(baseFilter)
        .populate("ownerId", "name email avatar")
        .populate("participants", "name email avatar")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      // Normalize _id to id for consistency with client expectations
      const normalizedRooms = rooms.map((room: any) => ({
        ...room,
        id: room._id.toString(),
        ownerId: room.ownerId
          ? {
              ...room.ownerId,
              id: room.ownerId._id.toString(),
            }
          : room.ownerId,
        participants: room.participants.map((p: any) =>
          typeof p === "object"
            ? {
                ...p,
                id: p._id.toString(),
              }
            : p
        ),
      }));

      const totalPages = Math.ceil(totalRooms / limit);

      res.json({
        success: true,
        data: {
          rooms: normalizedRooms,
          pagination: {
            currentPage: page,
            totalPages,
            totalRooms,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
          },
        },
      });
    } catch (error) {
      logger.error("Error fetching user rooms:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch rooms",
      });
    }
  }
);

// POST /api/rooms - Create a new room
router.post(
  "/",
  authenticate,
  validateCreateRoom,
  async (req: ExtendedAuthenticatedRequest, res: Response) => {
    try {
      const { name, settings = {} } = req.body;
      const userId = req.user!.id;
      const userPlan = req.user!.subscriptionPlan;

      // Check plan limits
      const canCreate = await canCreateRoom(userId, userPlan);
      if (!canCreate.allowed) {
        return res.status(403).json({
          success: false,
          error: canCreate.reason,
          data: {
            code: "PLAN_LIMIT_EXCEEDED",
            upgradeRequired: userPlan === SubscriptionPlan.FREE,
          },
        });
      }

      // Get plan limits for maxParticipants
      const planLimits = getPlanLimits(userPlan);

      // Compute maxParticipants: respect client request but enforce plan limits
      const requestedMax =
        settings.maxParticipants ?? planLimits.maxParticipants;
      const maxParticipants = Math.min(
        requestedMax,
        planLimits.maxParticipants
      );

      const room = new Room({
        name,
        ownerId: userId,
        participants: [userId], // Add owner to participants
        settings: {
          maxParticipants,
          isPublic: settings.isPublic || false,
          allowGuests:
            settings.allowGuests !== undefined ? settings.allowGuests : true,
          recordSessions: settings.recordSessions || false,
        },
      });

      await room.save();

      // Fetch the saved room with populated fields and normalize
      const populatedRoom = await Room.findById(room._id)
        .populate("ownerId", "name email avatar")
        .populate("participants", "name email avatar")
        .lean();

      if (!populatedRoom) {
        return res.status(500).json({
          success: false,
          error: "Failed to fetch created room",
        });
      }

      // Normalize _id to id
      const normalizedRoom = {
        ...populatedRoom,
        id: populatedRoom._id.toString(),
        ownerId: populatedRoom.ownerId
          ? {
              ...populatedRoom.ownerId,
              id: (populatedRoom.ownerId as any)._id.toString(),
            }
          : populatedRoom.ownerId,
        participants: populatedRoom.participants.map((p: any) =>
          typeof p === "object"
            ? {
                ...p,
                id: p._id.toString(),
              }
            : p
        ),
      };

      // Emit socket event
      const io = getSocketIO();
      io.to(`user:${userId}`).emit("room-created", normalizedRoom);

      res.status(201).json({
        success: true,
        data: { room: normalizedRoom },
      });
    } catch (error) {
      logger.error("Error creating room:", error);
      res.status(500).json({
        success: false,
        error: "Failed to create room",
      });
    }
  }
);

// GET /api/rooms/:id - Get room details
router.get(
  "/:id",
  authenticate,
  validateObjectId("id"),
  checkRoomParticipation,
  async (req: ExtendedAuthenticatedRequest, res: Response) => {
    try {
      const room = await Room.findById(req.params.id)
        .populate("ownerId", "name email avatar")
        .populate("participants", "name email avatar")
        .lean();

      if (!room) {
        return res.status(404).json({
          success: false,
          error: "Room not found",
        });
      }

      // Get active users via presence
      const activeUsers = await getUsersInRoom(req.params.id);

      // Normalize _id to id
      const normalizedRoom = {
        ...room,
        id: room._id.toString(),
        ownerId: room.ownerId
          ? {
              ...room.ownerId,
              id: (room.ownerId as any)._id.toString(),
            }
          : room.ownerId,
        participants: room.participants.map((p: any) =>
          typeof p === "object"
            ? {
                ...p,
                id: p._id.toString(),
              }
            : p
        ),
      };

      res.json({
        success: true,
        data: { room: normalizedRoom, activeUsers },
      });
    } catch (error) {
      logger.error("Error fetching room details:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch room details",
      });
    }
  }
);

// PUT /api/rooms/:id - Update room settings
router.put(
  "/:id",
  authenticate,
  validateObjectId("id"),
  checkRoomOwnership,
  validateUpdateRoom,
  async (req: ExtendedAuthenticatedRequest, res: Response) => {
    try {
      const { name, settings = {} } = req.body;
      const room = req.room!;

      // Update allowed fields
      if (name) room.name = name;
      if (settings.isPublic !== undefined)
        room.settings.isPublic = settings.isPublic;
      if (settings.allowGuests !== undefined)
        room.settings.allowGuests = settings.allowGuests;
      if (settings.recordSessions !== undefined) {
        // Recording sessions might be a PRO feature
        if (settings.recordSessions) {
          const owner = await User.findById(room.ownerId);
          if (owner && owner.subscriptionPlan === SubscriptionPlan.FREE) {
            return res.status(403).json({
              success: false,
              error: "Session recording requires PRO plan or higher",
              data: {
                feature: "recordSessions",
                currentPlan: owner.subscriptionPlan,
                requiredPlan: SubscriptionPlan.PRO,
                upgradeRequired: true,
              },
            });
          }
        }
        room.settings.recordSessions = settings.recordSessions;
      }

      // Handle maxParticipants update
      if (settings.maxParticipants !== undefined) {
        const owner = await User.findById(room.ownerId);
        if (!owner) {
          return res
            .status(500)
            .json({ success: false, error: "Room owner not found" });
        }

        const requested = Number(settings.maxParticipants);
        const minAllowed = room.participants.length;
        const maxAllowed = getPlanLimits(
          owner.subscriptionPlan
        ).maxParticipants;

        if (requested < minAllowed) {
          return res.status(400).json({
            success: false,
            error: `Cannot set maxParticipants below current participant count (${minAllowed})`,
          });
        }

        if (requested > maxAllowed) {
          return res.status(403).json({
            success: false,
            error: `Your ${owner.subscriptionPlan} plan allows a maximum of ${maxAllowed} participants. Upgrade to increase this limit.`,
          });
        }

        room.settings.maxParticipants = requested;
      }

      await room.save();

      // Fetch the updated room with populated fields and normalize
      const populatedRoom = await Room.findById(room._id)
        .populate("ownerId", "name email avatar")
        .populate("participants", "name email avatar")
        .lean();

      if (!populatedRoom) {
        return res.status(500).json({
          success: false,
          error: "Failed to fetch updated room",
        });
      }

      // Normalize _id to id
      const normalizedRoom = {
        ...populatedRoom,
        id: populatedRoom._id.toString(),
        ownerId: populatedRoom.ownerId
          ? {
              ...populatedRoom.ownerId,
              id: (populatedRoom.ownerId as any)._id.toString(),
            }
          : populatedRoom.ownerId,
        participants: populatedRoom.participants.map((p: any) =>
          typeof p === "object"
            ? {
                ...p,
                id: p._id.toString(),
              }
            : p
        ),
      };

      // Emit socket event to all room participants
      const io = getSocketIO();
      room.participants.forEach((participantId: any) => {
        io.to(`user:${participantId.toString()}`).emit(
          "room-updated",
          normalizedRoom
        );
      });

      res.json({
        success: true,
        data: { room: normalizedRoom },
      });
    } catch (error) {
      logger.error("Error updating room:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update room",
      });
    }
  }
);

// DELETE /api/rooms/:id - Delete room
router.delete(
  "/:id",
  authenticate,
  validateObjectId("id"),
  checkRoomOwnership,
  async (req: ExtendedAuthenticatedRequest, res: Response) => {
    try {
      const roomId = req.params.id;
      const room = req.room!;

      // Delete associated data
      await Promise.all([
        WhiteboardModel.deleteOne({ roomId }),
        Message.deleteMany({ roomId }),
      ]);

      // Remove all users from Redis presence
      try {
        const users = await getUsersInRoom(roomId);
        await Promise.all(
          Object.keys(users).map((userId) => removeUserFromRoom(userId, roomId))
        );
      } catch (redisError) {
        logger.warn("Error cleaning up Redis presence:", redisError);
      }

      // Emit socket event to all participants
      const io = getSocketIO();
      room.participants.forEach((participantId: any) => {
        io.to(`user:${participantId.toString()}`).emit("room-deleted", {
          roomId,
        });
      });

      await Room.findByIdAndDelete(roomId);

      res.status(204).send();
    } catch (error) {
      logger.error("Error deleting room:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete room",
      });
    }
  }
);

// POST /api/rooms/:id/join - Join room via invite code
router.post(
  "/:id/join",
  authenticate,
  validateObjectId("id"),
  async (req: ExtendedAuthenticatedRequest, res: Response) => {
    try {
      const { inviteCode } = req.body;
      const userId = req.user!.id;
      const userPlan = req.user!.subscriptionPlan;

      if (!inviteCode) {
        return res.status(400).json({
          success: false,
          error: "Invite code is required",
        });
      }

      const room = await Room.findOne({ inviteCode });
      if (!room) {
        return res.status(404).json({
          success: false,
          error: "Invalid invite code",
        });
      }

      // Verify the found room's _id matches req.params.id
      if (room._id.toString() !== (req as any).params.id) {
        return res.status(400).json({
          success: false,
          error: "Room ID and invite code do not match",
        });
      }

      if (!room.settings.allowGuests) {
        return res.status(403).json({
          success: false,
          error: "This room does not allow guests",
        });
      }

      // Check if already a participant
      const isAlreadyParticipant = room.participants.some(
        (p: any) => p.toString() === userId
      );
      if (isAlreadyParticipant) {
        // Fetch room with populated fields and normalize
        const populatedRoom = await Room.findById(room._id)
          .populate("ownerId", "name email avatar")
          .populate("participants", "name email avatar")
          .lean();

        if (!populatedRoom) {
          return res.status(500).json({
            success: false,
            error: "Failed to fetch room details",
          });
        }

        // Normalize _id to id
        const normalizedRoom = {
          ...populatedRoom,
          id: populatedRoom._id.toString(),
          ownerId: populatedRoom.ownerId
            ? {
                ...populatedRoom.ownerId,
                id: (populatedRoom.ownerId as any)._id.toString(),
              }
            : populatedRoom.ownerId,
          participants: populatedRoom.participants.map((p: any) =>
            typeof p === "object"
              ? {
                  ...p,
                  id: p._id.toString(),
                }
              : p
          ),
        };

        return res.json({
          success: true,
          data: { room: normalizedRoom },
          message: "Already a participant",
        });
      }

      // Enforce capacity using room's maxParticipants setting
      if (room.participants.length >= room.settings.maxParticipants) {
        return res.status(403).json({
          success: false,
          error: "Room is at capacity",
        });
      }

      // Get owner's plan for additional validation
      const owner = await User.findById(room.ownerId);
      if (!owner) {
        return res.status(500).json({
          success: false,
          error: "Room owner not found",
        });
      }

      const ownerPlan = owner.subscriptionPlan;
      const canAdd = canAddParticipant(room.participants.length, ownerPlan);
      if (!canAdd.allowed) {
        return res.status(403).json({
          success: false,
          error: canAdd.reason,
        });
      }

      await Room.findByIdAndUpdate(
        room._id,
        { $addToSet: { participants: userId } },
        { new: true }
      );

      const updatedRoom = await Room.findById(room._id)
        .populate("ownerId", "name email avatar")
        .populate("participants", "name email avatar")
        .lean();

      if (!updatedRoom) {
        return res.status(500).json({
          success: false,
          error: "Failed to fetch updated room",
        });
      }

      // Normalize _id to id
      const normalizedRoom = {
        ...updatedRoom,
        id: updatedRoom._id.toString(),
        ownerId: updatedRoom.ownerId
          ? {
              ...updatedRoom.ownerId,
              id: (updatedRoom.ownerId as any)._id.toString(),
            }
          : updatedRoom.ownerId,
        participants: updatedRoom.participants.map((p: any) =>
          typeof p === "object"
            ? {
                ...p,
                id: p._id.toString(),
              }
            : p
        ),
      };

      res.json({
        success: true,
        data: { room: normalizedRoom },
      });
    } catch (error) {
      logger.error("Error joining room:", error);
      res.status(500).json({
        success: false,
        error: "Failed to join room",
      });
    }
  }
);

// POST /api/rooms/:id/leave - Leave room
router.post(
  "/:id/leave",
  authenticate,
  validateObjectId("id"),
  checkRoomParticipation,
  async (req: ExtendedAuthenticatedRequest, res: Response) => {
    try {
      const roomId = req.params.id;
      const userId = req.user!.id;
      const room = req.room!;

      // Owner cannot leave their own room
      if (room.ownerId.toString() === userId) {
        return res.status(400).json({
          success: false,
          error: "Room owner cannot leave the room",
        });
      }

      await Room.findByIdAndUpdate(
        roomId,
        { $pull: { participants: userId } },
        { new: true }
      );

      // Remove from Redis presence if currently in room
      try {
        await removeUserFromRoom(userId, roomId);
      } catch (redisError) {
        logger.warn("Error removing from Redis presence:", redisError);
      }

      res.json({
        success: true,
        message: "Left room successfully",
      });
    } catch (error) {
      logger.error("Error leaving room:", error);
      res.status(500).json({
        success: false,
        error: "Failed to leave room",
      });
    }
  }
);

// GET /api/rooms/invite/:inviteCode - Get room info by invite code
router.get(
  "/invite/:inviteCode",
  optionalAuth,
  async (req: Request, res: Response) => {
    try {
      const { inviteCode } = req.params;

      const room = await Room.findOne({ inviteCode }).populate(
        "ownerId",
        "name"
      );

      if (!room || !room.settings.allowGuests) {
        return res.status(404).json({
          success: false,
          error: "Room not found or not available",
        });
      }

      const roomInfo = {
        roomId: room._id.toString(),
        roomName: room.name,
        ownerName: (room.ownerId as any).name,
        participantCount: room.participants.length,
        maxParticipants: room.settings.maxParticipants,
        isPublic: room.settings.isPublic,
      };

      res.json({
        success: true,
        data: { room: roomInfo },
      });
    } catch (error) {
      logger.error("Error fetching room by invite code:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch room information",
      });
    }
  }
);

// POST /api/rooms/:id/invite - Invite user to room
router.post(
  "/:id/invite",
  authenticate,
  validateObjectId("id"),
  checkRoomParticipation,
  async (req: ExtendedAuthenticatedRequest, res: Response) => {
    try {
      const { email, userId } = req.body;
      const room = req.room!;
      const roomId = req.params.id;

      // Require either email or userId
      if (!email && !userId) {
        return res
          .status(400)
          .json({
            success: false,
            error: "Either email or userId is required",
          });
      }

      // Check room capacity
      if (room.participants.length >= room.settings.maxParticipants) {
        return res
          .status(403)
          .json({ success: false, error: "Room is at capacity" });
      }

      // Get room owner and check plan limits
      const owner = await User.findById(room.ownerId);
      if (!owner) {
        return res
          .status(500)
          .json({ success: false, error: "Room owner not found" });
      }

      const canAdd = canAddParticipant(
        room.participants.length,
        owner.subscriptionPlan
      );
      if (!canAdd.allowed) {
        return res.status(403).json({
          success: false,
          error: canAdd.reason,
          data: {
            currentParticipants: room.participants.length,
            maxParticipants: room.settings.maxParticipants,
            upgradeRequired: owner.subscriptionPlan === SubscriptionPlan.FREE,
          },
        });
      }

      // Resolve invitee
      let invitee;
      if (userId) {
        invitee = await User.findById(userId);
      } else if (email) {
        invitee = await User.findOne({ email });
      }

      if (!invitee) {
        return res.status(404).json({
          success: false,
          error: "User not found",
        });
      }

      // Check if user is already a participant
      const isAlreadyParticipant = room.participants.some(
        (p: any) => p.toString() === invitee._id.toString()
      );
      if (isAlreadyParticipant) {
        return res.status(400).json({
          success: false,
          error: "User is already a participant",
        });
      }

      // Add user to room participants
      await Room.findByIdAndUpdate(
        roomId,
        { $addToSet: { participants: invitee._id } },
        { new: true }
      );

      // Emit invitation to invitee if online
      const io = getSocketIO();
      io.to(`user:${invitee._id.toString()}`).emit("room-invitation", {
        roomId,
        roomName: room.name,
        invitedBy: req.user!.name,
        inviteCode: room.inviteCode,
      });

      res.json({
        success: true,
        data: {
          inviteLink: `/join/${room.inviteCode}`,
          invitedUser: {
            id: invitee._id.toString(),
            name: invitee.name,
            email: invitee.email,
          },
        },
        message: "User invited successfully",
      });
    } catch (error) {
      logger.error("Error inviting user:", error);
      res.status(500).json({
        success: false,
        error: "Failed to invite user",
      });
    }
  }
);

// POST /api/rooms/:id/regenerate-invite - Regenerate room invite code
router.post(
  "/:id/regenerate-invite",
  authenticate,
  validateObjectId("id"),
  checkRoomOwnership,
  async (req: ExtendedAuthenticatedRequest, res: Response) => {
    try {
      const room = req.room!;

      // Generate new invite code
      room.inviteCode =
        Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15);

      await room.save();

      res.json({
        success: true,
        data: { inviteCode: room.inviteCode },
        message: "Invite code regenerated successfully",
      });
    } catch (error) {
      logger.error("Error regenerating invite code:", error);
      res.status(500).json({
        success: false,
        error: "Failed to regenerate invite code",
      });
    }
  }
);

export default router;

