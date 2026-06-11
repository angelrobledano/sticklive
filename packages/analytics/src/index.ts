import { PostHog } from 'posthog-node';

const apiKey = process.env['POSTHOG_API_KEY'];
const host = process.env['POSTHOG_HOST'];

if (!apiKey) {
  throw new Error('POSTHOG_API_KEY environment variable is required');
}

if (!host) {
  throw new Error('POSTHOG_HOST environment variable is required');
}

export const analytics = new PostHog(apiKey, { host });

export async function shutdownAnalytics(): Promise<void> {
  await analytics.shutdown();
}
