# First stage: compile things.
FROM node:14 AS Build

RUN npm -g install npm@latest
## Install Dependencies

WORKDIR /usr/src/common/eventing
COPY common/eventing/package*.json ./

WORKDIR /usr/src/ordering
COPY ordering/package*.json ./

WORKDIR /usr/src/web/web-react
COPY web/web-react/package*.json ./

WORKDIR /usr/src/web/web-server
COPY web/web-server/package*.json ./

WORKDIR /usr/src
COPY package*.json ./
# legacy-peer-deps required to run fluentui with react 18
RUN npm i --legacy-peer-deps



## Build Apps
ENV NODE_ENV=production

WORKDIR /usr/src
COPY tsconfig.build.json ./

WORKDIR /usr/src/common/eventing
COPY common/eventing/ ./
RUN npm run build

WORKDIR /usr/src/ordering
COPY ordering/ ./
RUN npm run build

WORKDIR /usr/src/web/web-react
COPY web/web-react/ ./
# Creates js in ./lib
RUN npm run-script build_lib
# Create webpack assets in ./out
RUN npm run-script build_assets_prod


WORKDIR /usr/src/web/web-server
COPY web/web-server/ ./
RUN npm run build



# Second stage: run things.
FROM node:14

WORKDIR /usr/src/common/eventing
COPY --from=build /usr/src/common/eventing/package*.json ./
COPY --from=build /usr/src/common/eventing/lib/ ./lib

WORKDIR /usr/src/ordering
COPY --from=build /usr/src/ordering/package*.json ./
COPY --from=build /usr/src/ordering/lib/ ./lib

WORKDIR /usr/src/web/web-react
COPY --from=build /usr/src/web/web-react/package*.json ./
COPY --from=build /usr/src/web/web-react/lib/ ./lib
COPY --from=build /usr/src/web/web-react/out/ ./out
COPY --from=build /usr/src/web/web-react/public/ ./public
COPY --from=build /usr/src/web/web-react/src/react-app-env.d.ts ./src/

WORKDIR /usr/src/web
COPY --from=build /usr/src/web/web-server/package*.json ./web-server/
COPY --from=build /usr/src/web/web-server/lib/ ./web-server/lib

#  Code dependencies from build stage
WORKDIR /usr/src/
COPY --from=build /usr/src/package*.json ./


ENV NODE_ENV=production
RUN npm -g install npm@latest
#COPY --from=build /usr/src/node_modules/ ./node_modules
RUN npm i --legacy-peer-deps --only=prod
RUN ls -R

WORKDIR /usr/src/web

EXPOSE 3000
CMD [ "node", "web-server/lib/server.js" ]