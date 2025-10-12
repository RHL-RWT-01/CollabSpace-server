import AWS from 'aws-sdk';
import { logger } from '../utils/logger.util';

// Configure AWS SDK
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
});

// Initialize S3 client
export const s3 = new AWS.S3();

// S3 bucket name from environment
export const S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || '';

// Helper function to upload file to S3
export const uploadFileToS3 = async (
  key: string,
  body: Buffer | string,
  contentType: string
): Promise<string> => {
  try {
    const params = {
      Bucket: S3_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
      ACL: 'public-read',
    };

    const result = await s3.upload(params).promise();
    logger.info(`File uploaded to S3: ${result.Location}`);
    return result.Location;
  } catch (error) {
    logger.error('Error uploading file to S3:', error);
    throw error;
  }
};

// Helper function to generate signed URL for private files
export const generateSignedUrl = (
  key: string,
  expiresIn: number = 3600
): string => {
  try {
    const params = {
      Bucket: S3_BUCKET_NAME,
      Key: key,
      Expires: expiresIn,
    };

    return s3.getSignedUrl('getObject', params);
  } catch (error) {
    logger.error('Error generating signed URL:', error);
    throw error;
  }
};

// Helper function to delete file from S3
export const deleteFileFromS3 = async (key: string): Promise<void> => {
  try {
    const params = {
      Bucket: S3_BUCKET_NAME,
      Key: key,
    };

    await s3.deleteObject(params).promise();
    logger.info(`File deleted from S3: ${key}`);
  } catch (error) {
    logger.error('Error deleting file from S3:', error);
    throw error;
  }
};

// Helper function to check if bucket exists
export const checkBucketExists = async (): Promise<boolean> => {
  try {
    await s3.headBucket({ Bucket: S3_BUCKET_NAME }).promise();
    return true;
  } catch (error) {
    logger.error('S3 bucket does not exist or is not accessible:', error);
    return false;
  }
};