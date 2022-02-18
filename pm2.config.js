module.exports = {
    apps: [
      {
        name: "blob",
        script: "npx azurite-blob --loose --silent --location ./__blobstorage__"
      },
      {
        name: "web",
        script: "node -r dotenv/config web-server/lib/server.js dotenv_config_path=../.env_local",
        cwd: "./web",
        watch: ["web", "common"],
        env: {
          NODE_ENV: "development",
        },
      },
      {
        name: "factory",
        script: "node -r dotenv/config lib/factoryStartup.js dotenv_config_path=../.env_local",
        cwd: "./factory",
        watch: ["factory", "common"],
        env: {
          NODE_ENV: "development",
        },
      },
      {
        name: "ordering",
        script: "node -r dotenv/config lib/orderingStartup.js dotenv_config_path=../.env_local",
        cwd: "./ordering",
        watch: ["ordering", "common"],
        env: {
          NODE_ENV: "development",
        },
      },
    ],
  };