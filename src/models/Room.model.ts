import mongoose, { Document, Schema } from "mongoose";
import { IUser } from "./User.model";

export interface IRoom {
  _id?: mongoose.Types.ObjectId;
  name: string;
  ownerId: mongoose.Types.ObjectId | IUser;
  participants: mongoose.Types.ObjectId[] | IUser[];
  whiteboardState: any;
  settings: {
    maxParticipants: number;
    isPublic: boolean;
    allowGuests: boolean;
    recordSessions: boolean;
  };
  inviteCode: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRoomDocument extends IRoom, Document {
  _id: mongoose.Types.ObjectId;
  hasAccess(userId: string): boolean;
  canAddParticipant(): boolean;
}

export interface IRoomModel extends mongoose.Model<IRoomDocument> {
  hasAccess(roomId: string, userId: string): Promise<boolean>;
  getUserRooms(userId: string): mongoose.Query<IRoomDocument[], IRoomDocument>;
}

const roomSchema = new Schema<IRoomDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    participants: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    whiteboardState: {
      type: Schema.Types.Mixed,
      default: {
        elements: [],
        appState: {},
        files: {},
      },
    },
    settings: {
      maxParticipants: {
        type: Number,
        default: 10,
      },
      isPublic: {
        type: Boolean,
        default: false,
      },
      allowGuests: {
        type: Boolean,
        default: true,
      },
      recordSessions: {
        type: Boolean,
        default: false,
      },
    },
    inviteCode: {
      type: String,
      required: true,
      unique: true,
      default: function () {
        return (
          Math.random().toString(36).substring(2, 15) +
          Math.random().toString(36).substring(2, 15)
        );
      },
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
roomSchema.index({ ownerId: 1 });
roomSchema.index({ inviteCode: 1 });
roomSchema.index({ participants: 1 });
roomSchema.index({ "settings.isPublic": 1 });

// Static methods for access control and participant management
roomSchema.statics.isOwner = async function (roomId: string, userId: string) {
  const room = await this.findById(roomId);
  return room ? room.ownerId.toString() === userId : false;
};

roomSchema.statics.isParticipant = async function (
  roomId: string,
  userId: string
) {
  const room = await this.findById(roomId);
  if (!room) return false;

  const isOwner = room.ownerId.toString() === userId;
  const isParticipant = room.participants.some(
    (p: any) => p.toString() === userId
  );

  return isOwner || isParticipant;
};

roomSchema.statics.findByInviteCode = async function (inviteCode: string) {
  return this.findOne({ inviteCode }).populate("ownerId participants");
};

roomSchema.statics.addParticipant = async function (
  roomId: string,
  userId: string
) {
  return this.findByIdAndUpdate(
    roomId,
    { $addToSet: { participants: userId } },
    { new: true }
  ).populate("ownerId participants");
};

roomSchema.statics.removeParticipant = async function (
  roomId: string,
  userId: string
) {
  return this.findByIdAndUpdate(
    roomId,
    { $pull: { participants: userId } },
    { new: true }
  );
};

roomSchema.statics.hasAccess = async function (roomId: string, userId: string) {
  const room = await this.findById(roomId);
  if (!room) return false;
  return (
    room.ownerId.toString() === userId ||
    room.participants.some((p) => p.toString() === userId)
  );
};

roomSchema.statics.getUserRooms = function (userId: string) {
  return this.find({
    $or: [{ ownerId: userId }, { participants: userId }],
  }).sort({ updatedAt: -1 });
};

// Instance methods
roomSchema.methods.hasAccess = function (userId: string) {
  const isOwner = this.ownerId.toString() === userId;
  const isParticipant = this.participants.some(
    (p: any) => p.toString() === userId
  );
  return isOwner || isParticipant || this.settings.isPublic;
};

roomSchema.methods.canAddParticipant = function () {
  return this.participants.length < this.settings.maxParticipants;
};

export const Room = mongoose.model<IRoomDocument, IRoomModel>(
  "Room",
  roomSchema
);

