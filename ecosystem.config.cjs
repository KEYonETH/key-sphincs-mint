module.exports = {
  apps: [
    {
      name: "key-backend",
      script: "scripts/start-production.js",
      cwd: __dirname,
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      time: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
