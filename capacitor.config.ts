const config = {
  appId: "com.superquina.app",
  appName: "Super Quina Cambista",
  // Capacitor requires a webDir even when loading the hosted Next.js application.
  // Keep a minimal directory available for native project synchronization.
  webDir: "www",
  server: {
    // The private cashier APK always starts at the dedicated cashier login.
    // Authentication and role authorization remain enforced by the server.
    url: "https://superquina.com/cashier-app-login",
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
