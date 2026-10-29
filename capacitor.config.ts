import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lbstore.app',
  appName: 'L$B Interior Design',
  webDir: 'www'
};

const deployedSiteUrl = process.env.CAPACITOR_SERVER_URL?.trim();
if (deployedSiteUrl) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(deployedSiteUrl);
  } catch {
    throw new Error('CAPACITOR_SERVER_URL must be a valid HTTPS URL.');
  }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
    throw new Error('CAPACITOR_SERVER_URL must be an HTTPS URL without embedded credentials.');
  }
  config.server = { url: parsedUrl.toString() };
}

export default config;
