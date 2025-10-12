import { Router, Request, Response } from "express";
import {
  authenticate,
  AuthenticatedRequest,
} from "../middleware/auth.middleware";
import { Room } from "../models/Room.model";
import Whiteboard from "../models/Whiteboard.model";
import { logger } from "../utils/logger.util";
import mongoose from "mongoose";

const router = Router();

// GET /api/whiteboard/:roomId - Load whiteboard state
router.get(
  "/:roomId",
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { roomId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      // Validate user is participant of room
      const room = await Room.findById(roomId);
      const isParticipant = room?.participants?.some(
        (p: any) => p?.toString?.() === userId
      );
      if (!room || !isParticipant) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Find Whiteboard by roomId
      const whiteboard = await Whiteboard.findOne({ roomId });

      if (!whiteboard) {
        // Return empty state for new whiteboard
        return res.json({
          success: true,
          data: {
            elements: [],
            appState: {},
            files: {},
            version: 0,
          },
        });
      }

      return res.json({
        success: true,
        data: {
          elements: whiteboard.elements,
          appState: whiteboard.appState,
          files: whiteboard.files,
          version: whiteboard.version,
        },
      });
    } catch (error) {
      logger.error("Error loading whiteboard:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// POST /api/whiteboard/:roomId/save - Manually save whiteboard state
router.post(
  "/:roomId/save",
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { roomId } = req.params;
      const { elements, appState, files } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      // Validate request body
      if (!Array.isArray(elements) || typeof appState !== "object") {
        return res.status(400).json({
          success: false,
          message: "Invalid request data",
        });
      }

      // Validate user is participant of room
      const room = await Room.findById(roomId);
      const isParticipant = room?.participants?.some(
        (p: any) => p?.toString?.() === userId
      );
      if (!room || !isParticipant) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Find or create Whiteboard document
      let whiteboard = await Whiteboard.findOne({ roomId });

      if (!whiteboard) {
        whiteboard = new Whiteboard({
          roomId,
          elements,
          appState,
          files: files || {},
          lastModifiedBy: userId,
        });
      } else {
        whiteboard.elements = elements;
        whiteboard.appState = appState;
        whiteboard.files = files || {};
        whiteboard.lastModifiedBy = new mongoose.Types.ObjectId(userId);
      }

      await whiteboard.save();

      return res.json({
        success: true,
        data: {
          version: whiteboard.version,
          savedAt: whiteboard.lastModifiedAt,
        },
      });
    } catch (error) {
      logger.error("Error saving whiteboard:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// POST /api/whiteboard/:roomId/snapshot - Create version snapshot
router.post(
  "/:roomId/snapshot",
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { roomId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      // Validate user is participant of room
      const room = await Room.findById(roomId);
      const isParticipant = room?.participants?.some(
        (p: any) => p?.toString?.() === userId
      );
      if (!room || !isParticipant) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Find Whiteboard by roomId
      const whiteboard = await Whiteboard.findOne({ roomId });
      if (!whiteboard) {
        return res.status(404).json({
          success: false,
          message: "Whiteboard not found",
        });
      }

      // Create snapshot by pushing to snapshots array
      const snapshot = {
        _id: new mongoose.Types.ObjectId(),
        elements: whiteboard.elements,
        appState: whiteboard.appState,
        files: whiteboard.files,
        timestamp: new Date(),
        userId: new mongoose.Types.ObjectId(userId),
        version: whiteboard.version,
      };

      whiteboard.snapshots.push(snapshot);
      await whiteboard.save();

      return res.json({
        success: true,
        data: {
          snapshotId: snapshot._id.toString(),
          timestamp: snapshot.timestamp,
        },
      });
    } catch (error) {
      logger.error("Error creating whiteboard snapshot:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// GET /api/whiteboard/:roomId/history - Get version history
router.get(
  "/:roomId/history",
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { roomId } = req.params;
      const { limit = "10" } = req.query;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      // Validate user is participant of room
      const room = await Room.findById(roomId);
      const isParticipant = room?.participants?.some(
        (p: any) => p?.toString?.() === userId
      );
      if (!room || !isParticipant) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      const limitNum = Math.min(parseInt(limit as string, 10) || 10, 50);

      // Get history from whiteboard snapshots
      const whiteboard = await Whiteboard.findOne({ roomId });
      const snapshots = whiteboard
        ? whiteboard.snapshots.slice(-limitNum).reverse()
        : [];

      // Generate thumbnail data for each snapshot (simplified)
      const snapshotsWithThumbnails = snapshots.map((snapshot: any) => {
        return {
          id: snapshot._id,
          timestamp: snapshot.timestamp,
          userId: snapshot.userId,
          userName: "User", // Would need to populate this from User model
          version: snapshot.version,
          elementCount: snapshot.elements ? snapshot.elements.length : 0,
          thumbnailData: null, // Simplified - would need proper thumbnail generation
          elements: snapshot.elements,
          appState: snapshot.appState,
          files: snapshot.files,
        };
      });

      // Get current whiteboard for version info
      const currentWhiteboard = await Whiteboard.findOne({ roomId });
      const currentVersion = currentWhiteboard ? currentWhiteboard.version : 0;

      return res.json({
        success: true,
        data: {
          snapshots: snapshotsWithThumbnails,
          total: snapshots.length,
          currentVersion,
        },
      });
    } catch (error) {
      logger.error("Error getting whiteboard history:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// POST /api/whiteboard/:roomId/restore/:snapshotId - Restore from snapshot
router.post(
  "/:roomId/restore/:snapshotId",
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { roomId, snapshotId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      // Validate user is owner of room (simplified - removed admins check)
      const room = await Room.findById(roomId);
      if (!room || room.ownerId.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: "Access denied - only room owner can restore",
        });
      }

      // Find Whiteboard by roomId
      const whiteboard = await Whiteboard.findOne({ roomId });
      if (!whiteboard) {
        return res.status(404).json({
          success: false,
          message: "Whiteboard not found",
        });
      }

      // Find snapshot by ID
      const snapshot = whiteboard.snapshots.find(
        (s: any) => s._id?.toString() === snapshotId
      );
      if (!snapshot) {
        return res.status(404).json({
          success: false,
          message: "Snapshot not found",
        });
      }

      // Restore elements, appState, files from snapshot
      whiteboard.elements = snapshot.elements;
      whiteboard.appState = snapshot.appState;
      whiteboard.files = snapshot.files;
      whiteboard.lastModifiedBy = new mongoose.Types.ObjectId(userId);

      await whiteboard.save();

      // Broadcast 'whiteboard-restored' event via Socket.IO
      const io = req.app.get("io");
      if (io) {
        io.to(roomId).emit("whiteboard-restored", {
          roomId,
          snapshotId: (snapshot as any)._id,
          restoredBy: { id: userId },
          newState: {
            elements: whiteboard.elements,
            appState: whiteboard.appState,
            files: whiteboard.files,
          },
          version: whiteboard.version,
          timestamp: new Date().toISOString(),
        });
      }

      return res.json({
        success: true,
        data: {
          version: whiteboard.version,
          restoredFrom: snapshot.timestamp,
        },
      });
    } catch (error) {
      logger.error("Error restoring whiteboard:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

export default router;

