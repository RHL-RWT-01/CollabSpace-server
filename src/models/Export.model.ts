import { Schema, model, Document, Types } from 'mongoose';

export interface IExport extends Document {
  userId: Types.ObjectId;
  roomId: Types.ObjectId;
  format: 'json' | 'png';
  fileName: string;
  s3Key: string;
  s3Url: string;
  fileSizeBytes: number;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const exportSchema = new Schema<IExport>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    roomId: {
      type: Schema.Types.ObjectId,
      ref: 'Room',
      required: true,
      index: true,
    },
    format: { type: String, enum: ['json', 'png'], required: true },
    fileName: { type: String, required: true },
    s3Key: { type: String, required: true },
    s3Url: { type: String, required: true },
    fileSizeBytes: { type: Number, required: true },
    expiresAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

// Indexes
exportSchema.index({ userId: 1, createdAt: -1 });
exportSchema.index({ roomId: 1, createdAt: -1 });
// exportSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // Removed TTL to prevent S3 orphaning

// Pre-save hook to set default expiration
exportSchema.pre('save', function (next) {
  if (!this.expiresAt) {
    const { User } = require('./User.model');
    User.findById(this.userId)
      .then((user: any) => {
        if (user) {
          const daysToExpire =
            user.subscriptionPlan === 'FREE'
              ? parseInt(process.env.EXPORT_RETENTION_DAYS_FREE || '7')
              : user.subscriptionPlan === 'PRO'
                ? parseInt(process.env.EXPORT_RETENTION_DAYS_PRO || '30')
                : parseInt(process.env.EXPORT_RETENTION_DAYS_TEAMS || '90');
          this.expiresAt = new Date(
            Date.now() + daysToExpire * 24 * 60 * 60 * 1000
          );
        }
        next();
      })
      .catch(next);
  } else {
    next();
  }
});

// Post-delete hook to cleanup S3 files when individual exports are deleted
exportSchema.post('findOneAndDelete', async function (doc) {
  if (doc && doc.s3Key) {
    try {
      const { deleteFileFromS3 } = require('@/config/aws');
      await deleteFileFromS3(doc.s3Key);
      console.log(`Cleaned up S3 file ${doc.s3Key} after export deletion`);
    } catch (error) {
      console.error(`Failed to cleanup S3 file ${doc.s3Key}:`, error);
    }
  }
});

// Static methods
exportSchema.statics.cleanupExpired = async function () {
  const { deleteFileFromS3 } = require('@/config/aws');
  const expiredExports = await this.find({ expiresAt: { $lt: new Date() } });

  for (const exportRecord of expiredExports) {
    try {
      await deleteFileFromS3(exportRecord.s3Key);
    } catch (error) {
      console.error(`Failed to delete S3 file ${exportRecord.s3Key}:`, error);
    }
  }

  await this.deleteMany({ expiresAt: { $lt: new Date() } });
  return expiredExports.length;
};

exportSchema.statics.getUserExports = async function (
  userId: string,
  limit: number = 20
) {
  return this.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('roomId', 'name')
    .exec();
};

exportSchema.statics.getRoomExports = async function (
  roomId: string,
  limit: number = 20
) {
  return this.find({ roomId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('userId', 'name email')
    .exec();
};

export const Export = model<IExport>('Export', exportSchema);
