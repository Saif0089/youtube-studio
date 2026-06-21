export interface Config { clientId: string; clientSecret: string; refreshToken: string; }

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const map = {
    YT_CLIENT_ID: env.YT_CLIENT_ID,
    YT_CLIENT_SECRET: env.YT_CLIENT_SECRET,
    YT_REFRESH_TOKEN: env.YT_REFRESH_TOKEN,
  };
  const missing = Object.entries(map).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  return { clientId: map.YT_CLIENT_ID!, clientSecret: map.YT_CLIENT_SECRET!, refreshToken: map.YT_REFRESH_TOKEN! };
}

export interface VoiceConfig { apiKey: string; voiceId: string; }

export function loadVoiceConfig(env: NodeJS.ProcessEnv = process.env): VoiceConfig {
  const map = { ELEVENLABS_API_KEY: env.ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID: env.ELEVENLABS_VOICE_ID };
  const missing = Object.entries(map).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  return { apiKey: map.ELEVENLABS_API_KEY!, voiceId: map.ELEVENLABS_VOICE_ID! };
}
