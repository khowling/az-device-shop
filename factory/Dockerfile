# First stage: compile things.
FROM node:14 AS Build

RUN npm -g install npm@latest
## Install Dependencies

WORKDIR /usr/src/common/eventing
COPY common/eventing/package*.json ./

WORKDIR /usr/src/factory
COPY factory/package*.json ./

WORKDIR /usr/src
COPY package*.json ./
# legacy-peer-deps required to run fluentui with react 18
RUN npm i 



## Build Apps
ENV NODE_ENV=production

WORKDIR /usr/src
COPY tsconfig.build.json ./

WORKDIR /usr/src/common/eventing
COPY common/eventing/ ./
RUN npm run build

WORKDIR /usr/src/factory
COPY factory/ ./
RUN npm run build

# Second stage: run things.
FROM node:14

#  Code dependencies from build stage
WORKDIR /usr/src/
COPY --from=build /usr/src/package*.json ./
COPY --from=build /usr/src/node_modules/ ./node_modules

WORKDIR /usr/src/common/eventing
COPY --from=build /usr/src/common/eventing/package*.json ./
COPY --from=build /usr/src/common/eventing/lib/ ./lib


WORKDIR /usr/src/factory
COPY --from=build /usr/src/factory/package*.json ./
COPY --from=build /usr/src/factory/lib/ ./lib

# Copy compiled typescript server


EXPOSE 3000
CMD [ "node", "lib/factoryStartup.js" ]