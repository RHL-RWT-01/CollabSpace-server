import { createLogger, format, transports } from 'winston';

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each log level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Tell winston about these colors
import winston from 'winston';
winston.addColors(colors);

// Define log format
const logFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  format.colorize({ all: true }),
  format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// Define which log level to use based on environment
const level = (): string => {
  const env = process.env.NODE_ENV || 'development';
  const isDevelopment = env === 'development';
  return isDevelopment ? 'debug' : 'warn';
};

// Create the logger
export const logger = createLogger({
  level: level(),
  levels,
  format: logFormat,
  transports: [
    // Console transport
    new transports.Console(),
    
    // File transports for production
    ...(process.env.NODE_ENV === 'production' ? [
      new transports.File({
        filename: 'logs/error.log',
        level: 'error',
        format: format.combine(
          format.uncolorize(),
          format.timestamp(),
          format.json()
        ),
      }),
      new transports.File({
        filename: 'logs/combined.log',
        format: format.combine(
          format.uncolorize(),
          format.timestamp(),
          format.json()
        ),
      }),
    ] : []),
  ],
});

// Stream object for Morgan HTTP logging middleware
export const httpLogStream = {
  write: (message: string) => {
    logger.http(message.trim());
  },
};

// Helper functions for structured logging
export const logError = (message: string, error?: any, metadata?: object) => {
  logger.error(message, {
    error: error?.message || error,
    stack: error?.stack,
    ...metadata,
  });
};

export const logInfo = (message: string, metadata?: object) => {
  logger.info(message, metadata);
};

export const logWarn = (message: string, metadata?: object) => {
  logger.warn(message, metadata);
};

export const logDebug = (message: string, metadata?: object) => {
  logger.debug(message, metadata);
};