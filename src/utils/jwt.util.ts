import jwt, { SignOptions } from "jsonwebtoken";

export interface TokenPayload {
  userId: string;
  email: string;
  name?: string;
  avatar?: string;
  subscriptionPlan: string;
  sessionId: string;
}

// Generate JWT access token
export const generateToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, process.env.JWT_SECRET || "fallback-secret", {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  } as SignOptions);
};

// Generate short-lived Socket.IO authentication token
export const generateSocketToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, process.env.JWT_SECRET || "fallback-secret", {
    expiresIn: "5m",
  } as SignOptions);
};

// Generate JWT refresh token
export const generateRefreshToken = (payload: TokenPayload): string => {
  return jwt.sign(
    payload,
    process.env.JWT_REFRESH_SECRET ||
      process.env.JWT_SECRET ||
      "fallback-secret",
    {
      expiresIn: "30d", // Refresh tokens last longer
    } as SignOptions
  );
};

// Verify JWT token
export const verifyToken = (token: string): TokenPayload => {
  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "fallback-secret"
    ) as TokenPayload;
    return decoded;
  } catch (error) {
    throw new Error("Invalid token");
  }
};

// Verify refresh token
export const verifyRefreshToken = (token: string): TokenPayload => {
  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_REFRESH_SECRET ||
        process.env.JWT_SECRET ||
        "fallback-secret"
    ) as TokenPayload;
    return decoded;
  } catch (error) {
    throw new Error("Invalid refresh token");
  }
};

// Extract token from request headers or cookies
export const extractToken = (
  authHeader?: string,
  cookies?: any
): string | null => {
  // Check Authorization header first
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Check cookies
  if (cookies && cookies.token) {
    return cookies.token;
  }

  return null;
};
