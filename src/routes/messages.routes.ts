import { Router, Response } from "express";
import { Message as MessageModel } from "../models/Message.model";
import {
  authenticate,
  AuthenticatedRequest,
} from "../middleware/auth.middleware";
import { validateObjectId } from "../middleware/validation.middleware";

const router = Router();

// Apply auth middleware to all routes
router.use(authenticate);

// GET /api/messages/:roomId - Get message history for a room
router.get(
  "/:roomId",
  validateObjectId("roomId"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { roomId } = req.params;
      const { limit = "50", before } = req.query;

      // Parse and validate limit
      const limitNum = Math.min(parseInt(limit as string) || 50, 100);

      // Build query
      const query: any = { roomId };

      // Add before filter if provided
      if (before) {
        query.createdAt = { $lt: new Date(before as string) };
      }

      // Fetch messages
      const messages = await MessageModel.find(query)
        .sort({ createdAt: -1 })
        .limit(limitNum)
        .populate("userId", "name avatar")
        .exec();

      // Transform messages to client format
      const transformedMessages = messages.reverse().map((message) => ({
        id: message._id.toString(),
        roomId: message.roomId.toString(),
        userId: message.userId.toString(),
        userName: message.userName,
        userAvatar: message.userAvatar,
        content: message.content,
        type: message.type,
        createdAt: message.createdAt.toISOString(),
      }));

      res.json({
        success: true,
        data: {
          messages: transformedMessages,
          hasMore: messages.length === limitNum,
          nextCursor:
            messages.length > 0 ? messages[0].createdAt.toISOString() : null,
        },
      });
    } catch (error) {
      console.error("Error fetching message history:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch message history",
      });
    }
  }
);

// POST /api/messages/:roomId - Send a new message (alternative to socket)
router.post(
  "/:roomId",
  validateObjectId("roomId"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { roomId } = req.params;
      const { content } = req.body;
      const user = req.user;

      if (
        !content ||
        typeof content !== "string" ||
        content.trim().length === 0
      ) {
        return res.status(400).json({
          success: false,
          error: "Message content is required",
        });
      }

      if (content.length > 1000) {
        return res.status(400).json({
          success: false,
          error: "Message content too long (max 1000 characters)",
        });
      }

      // Create message
      const message = new MessageModel({
        roomId,
        userId: user!.id,
        userName: user!.name,
        userAvatar: (user as any).avatar || null,
        content: content.trim(),
      });

      const savedMessage = await message.save();

      // Transform message to client format
      const transformedMessage = {
        id: savedMessage._id.toString(),
        roomId: savedMessage.roomId.toString(),
        userId: savedMessage.userId.toString(),
        userName: savedMessage.userName,
        userAvatar: savedMessage.userAvatar,
        content: savedMessage.content,
        type: savedMessage.type,
        createdAt: savedMessage.createdAt.toISOString(),
      };

      res.status(201).json({
        success: true,
        data: {
          message: transformedMessage,
        },
      });
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({
        success: false,
        error: "Failed to send message",
      });
    }
  }
);

// DELETE /api/messages/:roomId/:messageId - Delete a message
router.delete(
  "/:roomId/:messageId",
  validateObjectId("roomId"),
  validateObjectId("messageId"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { roomId, messageId } = req.params;
      const user = req.user;

      // Find the message
      const message = await MessageModel.findOne({
        _id: messageId,
        roomId,
      });

      if (!message) {
        return res.status(404).json({
          success: false,
          error: "Message not found",
        });
      }

      // Check if user owns the message or has admin rights
      if (message.userId.toString() !== user!.id && !(user as any).isAdmin) {
        return res.status(403).json({
          success: false,
          error: "Not authorized to delete this message",
        });
      }

      // Delete the message
      await MessageModel.findByIdAndDelete(messageId);

      res.json({
        success: true,
        data: {
          messageId,
        },
      });
    } catch (error) {
      console.error("Error deleting message:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete message",
      });
    }
  }
);

export default router;

