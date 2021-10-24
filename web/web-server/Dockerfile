# First stage: compile things.
FROM node:12 AS Build

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./
RUN npm i

# Copy the rest of the application
COPY . .

# Creates assets in ./build
ENV NODE_ENV=production
RUN npx webpack --config webpack.config.js

# compile React JSX in 'src' into 'lib' for SSR
RUN npx babel --config-file ./babel.config.json --out-dir lib ./src

# Compile server Typescript
RUN cd ./server && \
    npx tsc  --build ./tsconfig.json

# Second stage: run things.
FROM node:12
WORKDIR /usr/src/app

COPY package*.json ./
RUN npm i --production

# Copy compiled assets
COPY --from=build /usr/src/app/build build

# Copy compiled typescript server
COPY --from=build /usr/src/app/server/out server/out

# not using @babel/register to automatically compile files on the fly.
COPY --from=build /usr/src/app/lib lib

EXPOSE 3000
CMD [ "node", "server/out/web/server/server" ]