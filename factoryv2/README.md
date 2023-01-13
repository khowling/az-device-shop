

# Building your own from statch

## Run Mongo

MongoDB
Install and run mongo, (minimum version 4.2) using a replicaset. A replica set in MongoDB is a group of mongod processes that maintain a syncronised copy of the same data set to provide redundancy and high availability Replicasets are required to allow the programmer to use the Change Streams feature.

One member is deemed the primary node, receiving all write operations, while the other nodes are deemed secondary nodes. The secondaries replicate the primary’s oplog and apply the operations to their data sets such that the secondaries’ data sets reflect the primary’s data set. When a primary does not communicate with the other members for 10seconds, an eligible secondary calls for an election to nominate itself as the new primary

```
mkdir __mongo_data__
nohup mongod --replSet rs0  --dbpath ./__mongo_data__/ &
```
NOTE: First time only, run to setup the replicaset:

   ```
   mongo --eval 'rs.initiate({ _id: "rs0", members: [ { _id: 0, host : "localhost:27017" }]})'

   ```


## server

mkdir server; cd server
npm init -y
// https://www.typescriptlang.org/download
npm install typescript ts-node @types/node --save-dev
npx tsc --init

```
    "sourceMap": true,
    "outDir": "dist",
    "strict": true,

    "esModuleInterop": true
```

// https://trpc.io/docs/v10/quickstart#installation-snippets
npm install @trpc/server@next @trpc/client@next @trpc/react@next @trpc/next@next @tanstack/react-query --save
npm install zod --save

// add file

## Mongo Typescript ORM
https://www.prisma.io/docs/getting-started/setup-prisma/start-from-scratch/mongodb-typescript-mongodb
npx prisma
npx prisma init



// run watch
npx ts-node ./trcpRouter.