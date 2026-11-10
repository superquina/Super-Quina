const config = {
  appId: "com.superquina.app",
  appName: "Super Quina",
  // Capacitor requires a webDir even when loading the hosted Next.js application.
  // Keep a minimal directory available for native project synchronization.
  webDir: "www",
  server: {
    // The Next.js application and its API routes remain hosted on the server.
    url: "https://superquina.com",
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
