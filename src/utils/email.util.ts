import { Resend } from "resend";
import { logger } from "./logger.util";
import { isEmailEnabled, createMockResponse } from "./feature-flags.util";

interface EmailData {
  to: string | string[];
  subject: string;
  template: string;
  data: any;
}

// Create Resend client only if email is enabled
let resend: Resend | null = null;
if (isEmailEnabled()) {
  resend = new Resend(process.env.RESEND_API_KEY);
}

// Email templates
const templates = {
  "payment-success": (data: any) => ({
    subject: "Payment Confirmation - Your subscription is active",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Payment Confirmed!</h2>
        <p>Hi ${data.userName},</p>
        <p>Thank you for your payment. Your ${data.plan} subscription is now active.</p>
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3>Payment Details</h3>
          <p><strong>Amount:</strong> ${data.currency} ${data.amount}</p>
          <p><strong>Plan:</strong> ${data.plan}</p>
          <p><strong>Status:</strong> Active</p>
        </div>
        <p>You now have access to all ${data.plan} features. If you have any questions, feel free to reach out to our support team.</p>
        <p>Best regards,<br>The Team</p>
      </div>
    `,
    text: `
      Hi ${data.userName},
      
      Thank you for your payment. Your ${data.plan} subscription is now active.
      
      Payment Details:
      Amount: ${data.currency} ${data.amount}
      Plan: ${data.plan}
      Status: Active
      
      You now have access to all ${data.plan} features.
      
      Best regards,
      The Team
    `,
  }),

  "payment-failed": (data: any) => ({
    subject: "Payment Failed - Action Required",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc3545;">Payment Failed</h2>
        <p>Hi ${data.userName},</p>
        <p>We were unable to process your payment for your ${data.plan} subscription.</p>
        <div style="background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3>Payment Details</h3>
          <p><strong>Amount:</strong> ${data.currency} ${data.amount}</p>
          <p><strong>Plan:</strong> ${data.plan}</p>
          <p><strong>Status:</strong> Failed</p>
        </div>
        <p>Please update your payment method to continue enjoying your subscription benefits.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.CLIENT_URL}/billing" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">Update Payment Method</a>
        </div>
        <p>If you continue to experience issues, please contact our support team.</p>
        <p>Best regards,<br>The Team</p>
      </div>
    `,
    text: `
      Hi ${data.userName},
      
      We were unable to process your payment for your ${data.plan} subscription.
      
      Payment Details:
      Amount: ${data.currency} ${data.amount}
      Plan: ${data.plan}
      Status: Failed
      
      Please update your payment method to continue enjoying your subscription benefits.
      
      Visit ${process.env.CLIENT_URL}/billing to update your payment method.
      
      Best regards,
      The Team
    `,
  }),

  "subscription-canceled": (data: any) => ({
    subject: "Subscription Canceled",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Subscription Canceled</h2>
        <p>Hi ${data.userName},</p>
        <p>Your ${data.plan} subscription has been canceled as requested.</p>
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3>Cancellation Details</h3>
          <p><strong>Plan:</strong> ${data.plan}</p>
          <p><strong>Canceled on:</strong> ${new Date(data.canceledAt).toLocaleDateString()}</p>
          <p><strong>Access until:</strong> ${new Date(data.accessUntil).toLocaleDateString()}</p>
        </div>
        <p>You will continue to have access to your subscription features until ${new Date(data.accessUntil).toLocaleDateString()}.</p>
        <p>We're sorry to see you go! If you change your mind, you can reactivate your subscription anytime.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.CLIENT_URL}/billing" style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">Reactivate Subscription</a>
        </div>
        <p>Best regards,<br>The Team</p>
      </div>
    `,
    text: `
      Hi ${data.userName},
      
      Your ${data.plan} subscription has been canceled as requested.
      
      Cancellation Details:
      Plan: ${data.plan}
      Canceled on: ${new Date(data.canceledAt).toLocaleDateString()}
      Access until: ${new Date(data.accessUntil).toLocaleDateString()}
      
      You will continue to have access until ${new Date(data.accessUntil).toLocaleDateString()}.
      
      Visit ${process.env.CLIENT_URL}/billing to reactivate if you change your mind.
      
      Best regards,
      The Team
    `,
  }),

  "trial-ending": (data: any) => ({
    subject: "Your trial ends soon",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Your trial ends in ${data.daysLeft} days</h2>
        <p>Hi ${data.userName},</p>
        <p>Your ${data.plan} trial will end on ${new Date(data.trialEnd).toLocaleDateString()}.</p>
        <p>To continue enjoying all the premium features, please subscribe to a paid plan.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.CLIENT_URL}/pricing" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">Choose Your Plan</a>
        </div>
        <p>If you have any questions, our support team is here to help.</p>
        <p>Best regards,<br>The Team</p>
      </div>
    `,
    text: `
      Hi ${data.userName},
      
      Your ${data.plan} trial will end on ${new Date(data.trialEnd).toLocaleDateString()}.
      
      To continue enjoying premium features, please subscribe to a paid plan.
      
      Visit ${process.env.CLIENT_URL}/pricing to choose your plan.
      
      Best regards,
      The Team
    `,
  }),
};

export const sendEmail = async (emailData: EmailData): Promise<void> => {
  try {
    // Check if email service is enabled
    if (!isEmailEnabled()) {
      logger.info("📧 Email service disabled - Mock email sent:", {
        to: emailData.to,
        subject: emailData.subject,
        template: emailData.template,
        message: "Set ENABLE_EMAIL=true in .env to enable email sending",
      });
      return;
    }

    const template = templates[emailData.template as keyof typeof templates];

    if (!template) {
      throw new Error(`Email template '${emailData.template}' not found`);
    }

    const emailContent = template(emailData.data);

    if (!resend) {
      throw new Error("Resend client not initialized - check RESEND_API_KEY");
    }

    const result = await resend.emails.send({
      from: `${process.env.FROM_NAME || "CollabSpace"} <${process.env.FROM_EMAIL || "noreply@example.com"}>`,
      to: emailData.to,
      subject: emailData.subject || emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });

    logger.info("Email sent successfully:", {
      to: emailData.to,
      subject: emailData.subject || emailContent.subject,
      emailId: result.data?.id,
    });
  } catch (error: any) {
    logger.error("Error sending email:", {
      error: error.message,
      to: emailData.to,
      template: emailData.template,
    });
    // Don't throw error - email failures shouldn't break the application flow
  }
};

export const sendBulkEmails = async (emails: EmailData[]): Promise<void> => {
  const promises = emails.map((email) => sendEmail(email));
  await Promise.allSettled(promises);
};

// Utility function to validate email addresses
export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Function to send trial ending reminders
export const sendTrialEndingReminders = async (): Promise<void> => {
  try {
    // This would typically be called by a cron job
    const { Subscription } = await import("../models/Subscription.model");
    const { User } = await import("../models/User.model");

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

    // Find subscriptions ending in 1 or 3 days
    const endingSubscriptions = await Subscription.find({
      trialEnd: {
        $gte: tomorrow,
        $lte: threeDaysFromNow,
      },
      status: "trialing",
    }).populate("userId");

    for (const subscription of endingSubscriptions) {
      const user = await User.findById(subscription.userId);
      if (user) {
        const daysLeft = Math.ceil(
          (subscription.trialEnd!.getTime() - Date.now()) /
            (1000 * 60 * 60 * 24)
        );

        await sendEmail({
          to: user.email,
          subject: `Your trial ends in ${daysLeft} days`,
          template: "trial-ending",
          data: {
            userName: user.name,
            plan: subscription.plan,
            trialEnd: subscription.trialEnd,
            daysLeft,
          },
        });
      }
    }

    logger.info(
      `Sent trial ending reminders to ${endingSubscriptions.length} users`
    );
  } catch (error: any) {
    logger.error("Error sending trial ending reminders:", error);
  }
};

