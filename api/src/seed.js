import bcrypt from 'bcryptjs'
import { connectDb } from './db.js'
import { User } from './models/User.js'
import { seedDemoData } from './seedData.js'

// CLI: npm run seed → creates/refreshes the reviewer demo account
await connectDb()

const email = 'demo@penny.app'
let user = await User.findOne({ email })
if (!user) {
  user = await User.create({
    email,
    name: 'Jordan Avery',
    businessName: 'Bluepeak Studio',
    passwordHash: await bcrypt.hash('demo1234', 10),
    isDemo: true,
  })
  console.log('[seed] created demo user demo@penny.app / demo1234')
} else {
  console.log('[seed] demo user exists, refreshing data')
}

const result = await seedDemoData(user._id)
console.log(`[seed] done: ${result.clients} clients, ${result.invoices} invoices`)
process.exit(0)
