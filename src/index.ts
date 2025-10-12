import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import helmet from "helmet";
import { createServer } from "http";
import morgan from "morgan";
import {
  connectMongoDB,
  connectRedis,
  gracefulShutdown,
} from "./config/database";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import { initializeSocket } from "./socket";
import { httpLogStream, logger } from "./utils/logger.util";
import { logServiceStatus } from "./utils/feature-flags.util";

import apiRoutes from "./routes";
// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const httpServer = createServer(app);

// Get port from environment or default to 5000
const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

// Security middleware
app.use(
  helmet({
    crossOriginEmbedderPolicy: false, // Needed for Socket.IO
  })
);

// CORS configuration
app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Cookie parsing middleware
app.use(cookieParser());

// HTTP logging middleware
app.use(morgan("combined", { stream: httpLogStream }));

// API routes
app.use("/api", apiRoutes);

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "CollabSpace server is running",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Initialize Socket.IO
const io = initializeSocket(httpServer);

// Attach Socket.IO instance to app for use in routes
app.set("io", io);

// Database connections and server startup
const startServer = async (): Promise<void> => {
  try {
    // Connect to databases
    await connectMongoDB();
    await connectRedis();

    // Start HTTP server
    httpServer.listen(PORT, () => {
      logger.info(`🚀 CollabSpace server is running on port ${PORT}`);
      logger.info(`📡 Socket.IO server initialized`);
      logger.info(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
      logger.info(`🔗 Client URL: ${CLIENT_URL}`);

      // Log service status
      logServiceStatus();
    });
  } catch (error) {
    logger.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

// Graceful shutdown handling
const handleShutdown = async (signal: string): Promise<void> => {
  logger.info(`📡 Received ${signal}. Starting graceful shutdown...`);

  try {
    // Close HTTP server
    httpServer.close(() => {
      logger.info("🔌 HTTP server closed");
    });

    // Close Socket.IO server
    io.close(() => {
      logger.info("🔌 Socket.IO server closed");
    });

    // Close database connections
    await gracefulShutdown();

    logger.info("✅ Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    logger.error("❌ Error during graceful shutdown:", error);
    process.exit(1);
  }
};

// Handle process termination signals
process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));

// Handle uncaught exceptions
process.on("uncaughtException", (error: Error) => {
  logger.error("❌ Uncaught Exception:", error);
  logger.error("Stack trace:", error.stack);
  // Don't exit immediately, allow graceful shutdown
  handleShutdown("UNCAUGHT_EXCEPTION");
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason: any, promise: Promise<any>) => {
  logger.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
  // For development, don't exit on unhandled rejections - just log them
  if (process.env.NODE_ENV === "development") {
    logger.warn("Development mode: continuing after unhandled rejection");
  } else {
    handleShutdown("UNHANDLED_REJECTION");
  }
});

// Start the server
startServer();

