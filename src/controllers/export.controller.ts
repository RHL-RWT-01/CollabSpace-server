import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { uploadFileToS3, deleteFileFromS3 } from "../config/aws";
import Whiteboard from "../models/Whiteboard.model";
import { Room, IRoomDocument } from "../models/Room.model";
import { User } from "../models/User.model";
import { Export } from "../models/Export.model";
import { logger } from "../utils/logger.util";
import { incrementExportCount } from "../middleware/export-limits.middleware";

interface ExtendedAuthenticatedRequest extends AuthenticatedRequest {
  incrementExportUsage?: () => Promise<any>;
}

export const exportAsJSON = async (
  req: ExtendedAuthenticatedRequest,
  res: Response
) => {
  try {
    const { roomId, elements, appState, files } = req.body;
    const userId = req.user!.id;

    // Validate user has access to room
    const room: IRoomDocument | null = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({
        success: false,
        error: "Room not found",
      });
    }

    const hasAccess =
      room.ownerId.toString() === userId ||
      room.participants.some((p: any) => p.toString() === userId);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: "Access denied to this room",
      });
    }

    let whiteboardData;

    // Use provided payload if available, otherwise fetch from database
    if (elements || appState || files) {
      whiteboardData = {
        roomId,
        elements: elements || [],
        appState: appState || {},
        files: files || {},
        exportedAt: new Date().toISOString(),
        exportedBy: userId,
      };
    } else {
      // Fallback to database data
      const whiteboard = await Whiteboard.findOne({ roomId });
      if (!whiteboard) {
        return res.status(404).json({
          success: false,
          error: "Whiteboard not found",
        });
      }

      // Check for unsaved changes (warn if modified within last 30 seconds)
      const lastModified = whiteboard.lastModifiedAt;
      const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
      const hasRecentChanges = lastModified > thirtySecondsAgo;

      if (hasRecentChanges) {
        logger.warn(
          `Export requested with potential unsaved changes for room ${roomId}, last modified: ${lastModified}`
        );
      }

      whiteboardData = {
        roomId,
        elements: whiteboard.elements,
        appState: whiteboard.appState,
        files: whiteboard.files || {},
        exportedAt: new Date().toISOString(),
        exportedBy: userId,
      };
    }

    const jsonString = JSON.stringify(whiteboardData, null, 2);
    const buffer = Buffer.from(jsonString, "utf-8");
    const fileSizeBytes = buffer.length;

    // Generate unique filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `whiteboard-${roomId}-${timestamp}.json`;
    const s3Key = `exports/${userId}/${roomId}/${fileName}`;

    // Upload to S3
    const s3Url = await uploadFileToS3(s3Key, buffer, "application/json");

    // Create Export record with S3 cleanup on error
    let exportRecord;
    try {
      exportRecord = new Export({
        userId,
        roomId,
        format: "json",
        fileName,
        s3Key,
        s3Url,
        fileSizeBytes,
      });
      await exportRecord.save();
    } catch (error) {
      // Cleanup S3 file if database save fails
      try {
        await deleteFileFromS3(s3Key);
        logger.info(`Cleaned up S3 file ${s3Key} after database save failure`);
      } catch (s3Error) {
        logger.error(`Failed to cleanup S3 file ${s3Key}:`, s3Error);
      }
      throw error;
    }

    // Update user's storage usage
    const user = await User.findById(userId);
    if (user) {
      await user.updateStorageUsage(fileSizeBytes);
    }

    // Increment export count
    await incrementExportCount(userId);

    logger.info(`JSON export completed for user ${userId}, room ${roomId}`);

    res.json({
      success: true,
      data: {
        downloadUrl: s3Url,
        fileName,
        fileSize: fileSizeBytes,
        expiresAt: exportRecord.expiresAt,
      },
    });
  } catch (error: any) {
    logger.error("Error in JSON export:", error);

    if (error?.response?.status === 429 || error?.status === 429) {
      return res.status(429).json({
        success: false,
        error: "Rate limit exceeded. Please try again later.",
      });
    }

    res.status(500).json({
      success: false,
      error: "Failed to export whiteboard as JSON",
    });
  }
};

export const exportAsPNG = async (
  req: ExtendedAuthenticatedRequest,
  res: Response
) => {
  try {
    const { roomId, imageData } = req.body;
    const userId = req.user!.id;

    if (!imageData) {
      return res.status(400).json({
        success: false,
        error: "Image data is required",
      });
    }

    // Validate user has access to room
    const room: IRoomDocument | null = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({
        success: false,
        error: "Room not found",
      });
    }

    const hasAccess =
      room.ownerId.toString() === userId ||
      room.participants.some((p: any) => p.toString() === userId);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: "Access denied to this room",
      });
    }

    // Check for unsaved changes (warn if whiteboard modified within last 30 seconds)
    const whiteboard = await Whiteboard.findOne({ roomId });
    if (whiteboard) {
      const lastModified = whiteboard.lastModifiedAt;
      const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
      const hasRecentChanges = lastModified > thirtySecondsAgo;

      if (hasRecentChanges) {
        logger.warn(
          `PNG export requested with potential unsaved changes for room ${roomId}, last modified: ${lastModified}`
        );
      }
    }

    // Convert base64 to Buffer
    const base64Data = imageData.replace(/^data:image\/png;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    const fileSizeBytes = buffer.length;

    // Generate unique filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `whiteboard-${roomId}-${timestamp}.png`;
    const s3Key = `exports/${userId}/${roomId}/${fileName}`;

    // Upload to S3
    const s3Url = await uploadFileToS3(s3Key, buffer, "image/png");

    // Create Export record with S3 cleanup on error
    let exportRecord;
    try {
      exportRecord = new Export({
        userId,
        roomId,
        format: "png",
        fileName,
        s3Key,
        s3Url,
        fileSizeBytes,
      });
      await exportRecord.save();
    } catch (error) {
      // Cleanup S3 file if database save fails
      try {
        await deleteFileFromS3(s3Key);
        logger.info(`Cleaned up S3 file ${s3Key} after database save failure`);
      } catch (s3Error) {
        logger.error(`Failed to cleanup S3 file ${s3Key}:`, s3Error);
      }
      throw error;
    }

    // Update user's storage usage
    const user = await User.findById(userId);
    if (user) {
      await user.updateStorageUsage(fileSizeBytes);
      user.lastExportAt = new Date();
      await user.save();
    }

    // Increment export count
    await incrementExportCount(userId);

    logger.info(`PNG export completed for user ${userId}, room ${roomId}`);

    res.json({
      success: true,
      data: {
        downloadUrl: s3Url,
        fileName,
        fileSize: fileSizeBytes,
        expiresAt: exportRecord.expiresAt,
      },
    });
  } catch (error: any) {
    logger.error("Error in PNG export:", error);

    if (error?.response?.status === 429 || error?.status === 429) {
      return res.status(429).json({
        success: false,
        error: "Rate limit exceeded. Please try again later.",
      });
    }

    res.status(500).json({
      success: false,
      error: "Failed to export whiteboard as PNG",
    });
  }
};

export const getExportHistory = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user!.id;
    const { roomId, limit = 20, format } = req.query;

    let query: any = { userId };
    if (roomId) {
      // Validate access to specific room
      const room: IRoomDocument | null = await Room.findById(roomId);
      if (!room) {
        return res.status(404).json({
          success: false,
          error: "Room not found",
        });
      }

      const hasAccess =
        room.ownerId.toString() === userId ||
        room.participants.some((p: any) => p.toString() === userId);

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: "Access denied to this room",
        });
      }

      query.roomId = roomId;
    }

    if (format) {
      query.format = format;
    }

    const exports = await Export.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit as string), 100))
      .populate("roomId", "name")
      .exec();

    const total = await Export.countDocuments(query);

    res.json({
      success: true,
      data: {
        exports: exports.map((exp: any) => ({
          id: exp._id,
          roomId: (() => {
            const roomDoc = exp.populated("roomId")
              ? (exp.roomId as any)
              : null;
            return roomDoc ? roomDoc._id.toString() : exp.roomId.toString();
          })(),
          roomName: (() => {
            const roomDoc = exp.populated("roomId")
              ? (exp.roomId as any)
              : null;
            return roomDoc ? roomDoc.name : null;
          })(),
          format: exp.format,
          fileName: exp.fileName,
          fileSize: exp.fileSizeBytes,
          downloadUrl: exp.s3Url,
          createdAt: exp.createdAt,
          expiresAt: exp.expiresAt,
        })),
        total,
      },
    });
  } catch (error) {
    logger.error("Error fetching export history:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch export history",
    });
  }
};

