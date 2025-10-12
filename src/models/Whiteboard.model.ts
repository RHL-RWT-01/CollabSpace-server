import mongoose, { Document, Schema, Types } from 'mongoose';
import { IRoom } from './Room.model';
import { IUser } from './User.model';

// Whiteboard document interface
export interface IWhiteboard extends Document {
  roomId: Types.ObjectId;
  elements: any[];
  appState: any;
  files: any;
  version: number;
  lastModifiedBy: Types.ObjectId;
  lastModifiedAt: Date;
  snapshots: Array<{
    elements: any[];
    appState: any;
    files: any;
    timestamp: Date;
    userId: Types.ObjectId;
    version: number;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

// Whiteboard schema
const WhiteboardSchema = new Schema<IWhiteboard>(
  {
    roomId: {
      type: Schema.Types.ObjectId,
      ref: 'Room',
      required: true,
      index: true
    },
    elements: {
      type: [{ type: Schema.Types.Mixed }],
      default: []
    },
    appState: {
      type: Schema.Types.Mixed,
      default: {}
    },
    files: {
      type: Schema.Types.Mixed,
      default: {}
    },
    version: {
      type: Number,
      default: 0
    },
    lastModifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    lastModifiedAt: {
      type: Date,
      default: Date.now
    },
    snapshots: [{
      elements: {
        type: [Schema.Types.Mixed],
        default: []
      },
      appState: {
        type: Schema.Types.Mixed,
        default: {}
      },
      files: {
        type: Schema.Types.Mixed,
        default: {}
      },
      timestamp: {
        type: Date,
        default: Date.now
      },
      userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      version: {
        type: Number,
        required: true
      }
    }]
  },
  {
    timestamps: true
  }
);

// Indexes
WhiteboardSchema.index({ roomId: 1 });
WhiteboardSchema.index({ lastModifiedAt: -1 });
WhiteboardSchema.index({ roomId: 1, version: -1 });

// Pre-save middleware
WhiteboardSchema.pre('save', function (next) {
  const doc = this as unknown as IWhiteboard;
  if (doc.isModified('elements') || doc.isModified('appState') || doc.isModified('files')) {
    doc.version += 1;
    doc.lastModifiedAt = new Date();
    
    // Create snapshot if significant changes (more than 10 elements changed)
    if (doc.isModified('elements') && doc.elements.length > 10) {
      const snapshot = {
        elements: doc.elements,
        appState: doc.appState,
        files: doc.files,
        timestamp: new Date(),
        userId: doc.lastModifiedBy,
        version: doc.version
      };
      
      doc.snapshots.push(snapshot);
      
      // Keep only last 50 snapshots
      if (doc.snapshots.length > 50) {
        doc.snapshots = doc.snapshots.slice(-50);
      }
    }
  }
  next();
});

// Static methods
WhiteboardSchema.statics.findByRoomId = function(roomId: string) {
  return this.findOne({ roomId });
};

WhiteboardSchema.statics.createSnapshot = async function(
  roomId: string, 
  elements: any[], 
  appState: any, 
  files: any, 
  userId: string
) {
  // First get the current whiteboard to get the actual version
  const whiteboard = await this.findOne({ roomId });
  const currentVersion = whiteboard ? whiteboard.version : 0;
  
  return this.findOneAndUpdate(
    { roomId },
    {
      $push: {
        snapshots: {
          $each: [{
            elements,
            appState,
            files,
            timestamp: new Date(),
            userId,
            version: currentVersion + 1 // Use actual version
          }],
          $slice: -50 // Keep only last 50 snapshots
        }
      }
    },
    { new: true, upsert: true }
  );
};

WhiteboardSchema.statics.getHistory = function(roomId: string, limit: number = 10) {
  return this.findOne({ roomId })
    .select('snapshots')
    .then((doc: any) => {
      if (!doc) return [];
      return doc.snapshots
        .sort((a: any, b: any) => b.timestamp - a.timestamp)
        .slice(0, limit);
    });
};

const Whiteboard = mongoose.model<IWhiteboard>('Whiteboard', WhiteboardSchema);

export default Whiteboard;