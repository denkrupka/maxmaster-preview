import { supabase, SUPABASE_ANON_KEY } from './supabase';
import { NotificationChannel } from '../types';

const SUPABASE_URL = 'https://diytvuczpciikzdhldny.supabase.co';

interface SendSMSParams {
  phoneNumber: string;
  message: string;
  userId?: string;
  templateCode?: string;
}

interface SMSResponse {
  success: boolean;
  smsId?: string;
  phoneNumber?: string;
  message?: string;
  error?: string;
  details?: string;
}

/**
 * Sends SMS via Supabase Edge Function
 * The Edge Function securely stores the SMSAPI.pl token
 */
export const sendSMS = async ({
  phoneNumber,
  message,
  userId,
  templateCode,
}: SendSMSParams): Promise<SMSResponse> => {
  try {
    // Get current session token for auth
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || SUPABASE_ANON_KEY;

    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-sms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        phoneNumber,
        message,
        userId,
        templateCode,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('SMS sending failed:', data);
      return {
        success: false,
        error: data.error || 'Failed to send SMS',
        details: data.details,
      };
    }

    return {
      success: true,
      smsId: data.smsId,
      phoneNumber: data.phoneNumber,
      message: data.message,
    };
  } catch (error) {
    console.error('Error sending SMS:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

/**
 * Replaces template variables in message
 * Example: "Hello {{firstName}}" with { firstName: "John" } => "Hello John"
 */
export const replaceTemplateVariables = (
  template: string,
  variables: Record<string, string>
): string => {
  let result = template;
  Object.entries(variables).forEach(([key, value]) => {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
  });
  return result;
};

/**
 * Sends SMS notification based on template code
 */
export const sendTemplatedSMS = async (
  templateCode: string,
  phoneNumber: string,
  variables: Record<string, string>,
  userId?: string
): Promise<SMSResponse> => {
  // Import templates statically (dynamic was causing vite warning)
  const { NOTIFICATION_TEMPLATES } = await import(/* @vite-ignore */ '../constants');

  const template = NOTIFICATION_TEMPLATES.find(t => t.code === templateCode);

  if (!template) {
    return {
      success: false,
      error: `Template not found: ${templateCode}`,
    };
  }

  // Check if this template should be sent via SMS
  if (template.channel !== NotificationChannel.BOTH && template.channel !== NotificationChannel.SMS) {
    return {
      success: false,
      error: `Template ${templateCode} is not configured for SMS (channel: ${template.channel})`,
    };
  }

  // Replace variables in the body
  const message = replaceTemplateVariables(template.body, variables);

  return sendSMS({
    phoneNumber,
    message,
    userId,
    templateCode,
  });
};

/**
 * Sends bulk SMS to multiple recipients (for mass notifications)
 */
export const sendBulkSMS = async (
  recipients: Array<{ phoneNumber: string; userId?: string }>,
  message: string,
  templateCode?: string
): Promise<{ sent: number; failed: number; results: SMSResponse[] }> => {
  const results: SMSResponse[] = [];
  let sent = 0;
  let failed = 0;

  // Send SMS sequentially to avoid rate limiting
  for (const recipient of recipients) {
    const result = await sendSMS({
      phoneNumber: recipient.phoneNumber,
      message,
      userId: recipient.userId,
      templateCode,
    });

    results.push(result);

    if (result.success) {
      sent++;
    } else {
      failed++;
    }

    // Add small delay between requests (250ms) to respect rate limits
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  return { sent, failed, results };
};
