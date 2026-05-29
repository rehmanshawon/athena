module.exports = {
  apps: [
    {
      name: "screensolver-backend",
      cwd: "/home/ubuntu/screensolver/apps/backend",
      script: "dist/server.js",
      interpreter: "node",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: "8000",
        WEB_BASE_URL: "https://www.ilogicmagic.com/screensolver",
        OPENAI_MODEL: "gpt-4o"
      }
    }
  ]
};
