
# Enable Mongo

# Enable azurite (Storage Emulator)
cd ./web
PORT=30001 NODE_PATH=./web-server/node_modules node -r dotenv/config ./web-server/lib/server.js dotenv_config_path=../.env_local