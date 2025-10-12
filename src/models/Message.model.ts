import mongoose, { Document, Schema } from "mongoose";
import { IUser } from "./User.model";
import { IRoom } from "./Room.model";

export interface IMessage {
  _id?: mongoose.Types.ObjectId;
  roomId: mongoose.Types.ObjectId | IRoom;
  userId: mongoose.Types.ObjectId | IUser;
  userName: string;
  userAvatar?: string;
  content: string;
  type: "text" | "system";
  createdAt: Date;
  updatedAt: Date;
}

export interface IMessageDocument extends IMessage, Document {
  _id: mongoose.Types.ObjectId;
}

const messageSchema = new Schema<IMessageDocument>(
  {
    roomId: {
      type: Schema.Types.ObjectId,
      ref: "Room",
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    userName: {
      type: String,
      required: true,
      trim: true,
    },
    userAvatar: {
      type: String,
      trim: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["text", "system"],
      default: "text",
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
messageSchema.index({ roomId: 1, createdAt: -1 });
messageSchema.index({ userId: 1 });

// Full implementation including message validation and methods will be added in subsequent phases

export const Message = mongoose.model<IMessageDocument>(
  "Message",
  messageSchema
);

