import axios from 'axios';
import { extractErrorMessage } from './functions.js';

async function sendDiscordError(error: Error | string, context?: Record<string, any>): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  
  // If no webhook configured, silently return
  if (!webhookUrl) {
    return;
  }

  try {
    const errorMessage = extractErrorMessage(error);
    
    if (errorMessage.includes('API key not valid')){
      return
    }

    const errorStack = error instanceof Error ? error.stack : undefined;
    
    // Build embed fields
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [
      {
        name: '❌ Error',
        value: `\`\`\`${errorMessage.substring(0, 1000)}\`\`\``,
      }
    ];

    // Add stack trace if available
    if (errorStack) {
      fields.push({
        name: '📋 Stack Trace',
        value: `\`\`\`${errorStack.substring(0, 1000)}\`\`\``,
      });
    }

    // Add context if provided
    if (context) {
      fields.push({
        name: '📝 Context',
        value: `\`\`\`json\n${JSON.stringify(context, null, 2).substring(0, 1000)}\`\`\``,
      });
    }

    // Add timestamp
    fields.push({
      name: '🕐 Time',
      value: new Date().toISOString(),
      inline: true,
    });

    // Send to Discord
    await axios.post(webhookUrl, {
      embeds: [
        {
          title: '🚨 Backend Error',
          color: 0xFF0000, // Red
          fields: fields,
          timestamp: new Date().toISOString(),
        },
      ],
    });
  } catch (webhookError) {
    // Don't throw if Discord notification fails - just log it
    console.error('Failed to send error to Discord:', webhookError);
  }
}

export { sendDiscordError };