/**
 * Feature flags utility for enabling/disabling services
 * This allows development without requiring API keys for all services
 */

export interface FeatureFlags {
  payments: boolean;
  email: boolean;
  ai: boolean;
  storage: boolean;
}

// Parse boolean from environment variables
const parseBoolean = (value: string | undefined): boolean => {
  if (!value) return false;
  return value.toLowerCase() === "true";
};

export const featureFlags: FeatureFlags = {
  payments: parseBoolean(process.env.ENABLE_PAYMENTS),
  email: parseBoolean(process.env.ENABLE_EMAIL),
  ai: parseBoolean(process.env.ENABLE_AI),
  storage: parseBoolean(process.env.ENABLE_STORAGE),
};

// Service availability checkers
export const isPaymentsEnabled = (): boolean => {
  return (
    featureFlags.payments &&
    !!process.env.RAZORPAY_KEY_ID &&
    !!process.env.RAZORPAY_KEY_SECRET
  );
};

export const isEmailEnabled = (): boolean => {
  return featureFlags.email && !!process.env.RESEND_API_KEY;
};

export const isAIEnabled = (): boolean => {
  return featureFlags.ai && !!process.env.OPENAI_API_KEY;
};

export const isStorageEnabled = (): boolean => {
  return (
    featureFlags.storage &&
    !!process.env.AWS_ACCESS_KEY_ID &&
    !!process.env.AWS_SECRET_ACCESS_KEY
  );
};

// Mock response generators for disabled services
export const createMockResponse = (service: string, action: string) => ({
  success: false,
  error: `${service} service is disabled`,
  message: `Set ENABLE_${service.toUpperCase()}=true in .env to enable ${action}`,
  mock: true,
});

// Logging helper
export const logServiceStatus = (): void => {
  console.log("\n🚀 Service Status:");
  console.log(
    `  💳 Payments: ${isPaymentsEnabled() ? "✅ Enabled" : "❌ Disabled"}`
  );
  console.log(`  📧 Email: ${isEmailEnabled() ? "✅ Enabled" : "❌ Disabled"}`);
  console.log(`  🤖 AI: ${isAIEnabled() ? "✅ Enabled" : "❌ Disabled"}`);
  console.log(
    `  💾 Storage: ${isStorageEnabled() ? "✅ Enabled" : "❌ Disabled"}\n`
  );
};
