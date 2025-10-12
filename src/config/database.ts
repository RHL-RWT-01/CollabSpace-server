import mongoose from 'mongoose';
import { createClient } from 'redis';
import { logger as dbLogger } from '../utils/logger.util';

// MongoDB connection
export const connectMongoDB = async (): Promise<void> => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/collabspace';
    
    await mongoose.connect(mongoUri);
    
    dbLogger.info('✅ MongoDB connected successfully');
    
    mongoose.connection.on('error', (error) => {
      dbLogger.error('❌ MongoDB connection error:', error);
    });
    
    mongoose.connection.on('disconnected', () => {
      dbLogger.warn('⚠️ MongoDB disconnected');
    });
    
    mongoose.connection.on('reconnected', () => {
      dbLogger.info('🔄 MongoDB reconnected');
    });
    
  } catch (error) {
    dbLogger.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
};

// Redis client
export const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

// Redis connection
export const connectRedis = async (): Promise<void> => {
  try {
    await redisClient.connect();
    dbLogger.info('✅ Redis connected successfully');
    
    redisClient.on('error', (error) => {
      dbLogger.error('❌ Redis connection error:', error);
    });
    
    redisClient.on('disconnect', () => {
      dbLogger.warn('⚠️ Redis disconnected');
    });
    
    redisClient.on('reconnecting', () => {
      dbLogger.info('🔄 Redis reconnecting...');
    });
    
  } catch (error) {
    dbLogger.error('❌ Redis connection failed:', error);
    process.exit(1);
  }
};

// Graceful shutdown
export const gracefulShutdown = async (): Promise<void> => {
  try {
    await mongoose.connection.close();
    await redisClient.quit();
    dbLogger.info('🔌 Database connections closed gracefully');
  } catch (error) {
    dbLogger.error('❌ Error during graceful shutdown:', error);
  }
};