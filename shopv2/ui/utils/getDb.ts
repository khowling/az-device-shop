import { MongoClient } from 'mongodb'

const murl : string = process.env.MONGO_DB || "mongodb://localhost:27017/dbdev?replicaSet=rs0"
const client = new MongoClient(murl);

 
export const getDb = async () => {
    // Connect MongoDB
  await client.connect();
  return client.db();
}