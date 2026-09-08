import mongoose from 'mongoose'
import { config } from './config.js'

export async function connectDb() {
  mongoose.set('strictQuery', true)
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 })
  } catch (err) {
    const target = config.mongoUri.replace(/\/\/[^@]*@/, '//***@')
    console.error(`[db] could not connect to ${target}: ${err.message}`)
    console.error('[db] is mongod running, and is MONGODB_URI correct?')
    process.exit(1)
  }
  console.log(`[db] connected: ${mongoose.connection.name}`)
}
