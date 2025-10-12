import { Server, Socket } from "socket.io";
import { Message } from "../types";
import {
  Message as MessageModel,
  IMessageDocument,
} from "../models/Message.model";

export class ChatHandler {
  private io: Server;

  constructor(io: Server) {
    this.io = io;
  }

  handleConnection(socket: Socket) {
    console.log(`User ${socket.data.user?.id} connected for chat`);

    // Handle joining a room for chat
    socket.on("chat:join", async (roomId: string) => {
      try {
        socket.join(`chat:${roomId}`);
        console.log(`User ${socket.data.user?.id} joined chat room ${roomId}`);

        // Load recent messages for the room
        const recentMessages: IMessageDocument[] = await MessageModel.find({
          roomId,
        })
          .sort({ createdAt: -1 })
          .limit(50)
          .populate("userId", "name avatar")
          .exec();

        // Transform messages to client format
        const transformedMessages = recentMessages
          .reverse()
          .map((message: IMessageDocument) => ({
            id: message._id.toString(),
            roomId: message.roomId.toString(),
            userId: message.userId.toString(),
            userName: message.userName,
            userAvatar: message.userAvatar,
            content: message.content,
            type: message.type,
            createdAt: message.createdAt.toISOString(),
          }));

        // Send recent messages to the user
        socket.emit("chat:history", transformedMessages);
      } catch (error) {
        console.error("Error joining chat room:", error);
        socket.emit("chat:error", "Failed to join chat room");
      }
    });

    // Handle leaving a room
    socket.on("chat:leave", (roomId: string) => {
      socket.leave(`chat:${roomId}`);
      console.log(`User ${socket.data.user?.id} left chat room ${roomId}`);
    });

    // Handle sending a message
    socket.on(
      "chat:message",
      async (data: { roomId: string; content: string; tempId: string }) => {
        try {
          const { roomId, content, tempId } = data;
          const user = socket.data.user;

          if (!user) {
            socket.emit("chat:error", "User not authenticated");
            return;
          }

          // Create message in database
          const message = new MessageModel({
            roomId,
            userId: user.id,
            content,
            userName: user.name,
            userAvatar: user.avatar,
            createdAt: new Date(),
          });

          const savedMessage: IMessageDocument = await message.save();

          // Create message object to broadcast
          const messageData: Message = {
            id: savedMessage._id.toString(),
            roomId: savedMessage.roomId.toString(),
            userId: savedMessage.userId.toString(),
            userName: savedMessage.userName,
            userAvatar: savedMessage.userAvatar,
            content: savedMessage.content,
            type: savedMessage.type,
            createdAt: savedMessage.createdAt.toISOString(),
            tempId,
          };

          // Broadcast to all users in the room
          this.io.to(`chat:${roomId}`).emit("chat:message", messageData);

          console.log(`Message sent in room ${roomId} by user ${user.id}`);
        } catch (error) {
          console.error("Error sending message:", error);
          socket.emit("chat:error", "Failed to send message");
        }
      }
    );

    // Handle typing indicators
    socket.on("chat:typing:start", (data: { roomId: string }) => {
      // Validate input data
      if (!data || !data.roomId) return;

      const { roomId } = data;
      const user = socket.data.user;

      if (!user) return;

      socket.to(`chat:${roomId}`).emit("chat:typing:start", {
        userId: user.id,
        userName: user.name,
      });
    });

    socket.on("chat:typing:stop", (data: { roomId: string }) => {
      // Validate input data
      if (!data || !data.roomId) return;

      const { roomId } = data;
      const user = socket.data.user;

      if (!user) return;

      socket.to(`chat:${roomId}`).emit("chat:typing:stop", {
        userId: user.id,
      });
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      console.log(`User ${socket.data.user?.id} disconnected from chat`);
    });
  }
}

