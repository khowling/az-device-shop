# First stage: compile things.
FROM node:14 AS Build

## Build node_modules layer

WORKDIR /usr/src/common/eventing
COPY common/eventing/package*.json ./
# build node_modules
RUN npm i 


WORKDIR /usr/src/ordering
COPY ordering/package*.json ./
# build node_modules
RUN npm i 

WORKDIR /usr/src/web/web-react
COPY web/web-react/package*.json ./
# build node_modules
RUN npm i --force # needed for fluentui with react 18

WORKDIR /usr/src
COPY package*.json ./
RUN npm i 

WORKDIR /usr/src/web/web-server
COPY web/web-server/package*.json ./
# build node_modules
RUN npm i 


## Build Apps
ENV NODE_ENV=production

WORKDIR /usr/src/common/eventing
COPY common/eventing/* ./
RUN npm run build

WORKDIR /usr/src/ordering
COPY ordering/* ./
RUN npm run build


WORKDIR /usr/src/web/web-react
COPY web/web-react/* ./
# Creates js in ./lib
RUN npm run-script build_lib
# Create webpack assets in ./out
RUN npm run-script build_assets_dev


WORKDIR /usr/src/web
COPY web/web-server/* web-server/

# Compile server Typescript
RUN npx tsc  --build ./web-server/tsconfig.json



# Second stage: run things.
FROM node:14

WORKDIR /usr/src/common/eventing
COPY --from=build /usr/src/common/eventing/package*.json ./
COPY --from=build /usr/src/common/eventing/node_modules ./
COPY --from=build /usr/src/common/eventing/lib ./

WORKDIR /usr/src/ordering
COPY --from=build /usr/src/ordering/package*.json ./
COPY --from=build /usr/src/ordering/node_modules ./
COPY --from=build /usr/src/ordering/lib ./

WORKDIR /usr/src/web/web-react
COPY --from=build /usr/src/web/web-react/package*.json ./
COPY --from=build /usr/src/web/web-react/node_modules ./
COPY --from=build /usr/src/web/web-react/lib ./
COPY --from=build /usr/src/web/web-react/out ./
COPY --from=build /usr/src/web/web-react/public ./
COPY --from=build /usr/src/web/web-react/src/react-app-env.d.ts ./src

WORKDIR /usr/src
COPY --from=build /usr/src/package*.json ./
RUN npm i --production


WORKDIR /usr/src/web
COPY --from=build /usr/src/web/web-server/package*.json ./web-server
COPY --from=build /usr/src/web/web-server/node_modules ./web-server
COPY --from=build /usr/src/web/web-server/lib ./web-server

# Copy compiled typescript server



EXPOSE 3000
CMD [ "node", "web-server/lib/server.ts" ]