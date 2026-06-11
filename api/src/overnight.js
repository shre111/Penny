import cron from 'node-cron'
import { Invoice } from './models/Invoice.js'
import { User } from './models/User.js'
import { Email } from './models/Email.js'
import { emitChange } from './realtime.js'
import { config } from './config.js'

/**
 * The overnight shift. Every day at 06:00 (server time) Penny checks each
 * business for overdue invoices that haven't been chased lately, drafts
 * reminder emails (AI service), and QUEUES them — nothing sends until the
 * owner approves in the morning. Also triggerable on demand for demos.
 */
export async function runOvernightForUser(userId) {
  const user = await User.findById(userId)
  const resp = await fetch(`${config.aiUrl}/overnight`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Service-Token': config.serviceToken },
    body: JSON.stringify({
      user_id: String(userId),
      user_name: user?.name || '',
      business_name: user?.businessName || '',
    }),
  })
  if (!resp.ok) throw new Error(`AI overnight ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
  return resp.json() // { queued, skipped }
}

export function startOvernightSchedule() {
  cron.schedule('0 6 * * *', async () => {
    try {
      const userIds = await Invoice.distinct('userId', { status: 'sent', dueDate: { $lt: new Date() } })
      console.log(`[overnight] nightly run for ${userIds.length} business(es)`)
      for (const userId of userIds) {
        try {
          const result = await runOvernightForUser(userId)
          if (result.queued > 0) console.log(`[overnight] queued ${result.queued} draft(s) for ${userId}`)
        } catch (err) {
          console.error(`[overnight] user ${userId}:`, err.message)
        }
      }
    } catch (err) {
      console.error('[overnight] nightly run failed:', err.message)
    }
  })
  console.log('[overnight] scheduled daily at 06:00')

  // earned-autonomy sends: fire scheduled reminders whose cancel window passed
  cron.schedule('* * * * *', async () => {
    try {
      const due = await Email.find({ status: 'scheduled', sendAt: { $lte: new Date() } }).limit(20)
      for (const email of due) {
        let result = { status: 'simulated', error: null }
        try {
          const upstream = await fetch(`${config.aiUrl}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Service-Token': config.serviceToken },
            body: JSON.stringify({ to: email.to, subject: email.subject, body: email.body }),
          })
          if (upstream.ok) result = await upstream.json()
        } catch {
          /* AI service unreachable → record simulated, don't drop the send */
        }
        email.status = result.status === 'failed' ? 'failed' : result.status
        email.provider = result.status === 'sent' ? 'composio-gmail' : 'simulated'
        email.error = result.error || undefined
        await email.save()
        if (email.invoiceId && ['sent', 'simulated'].includes(email.status)) {
          await Invoice.findOneAndUpdate({ _id: email.invoiceId, userId: email.userId }, { lastReminderAt: new Date() })
        }
        emitChange(email.userId, { entity: 'email', action: 'updated', id: email._id, actor: 'agent', doc: email })
        console.log(`[autonomy] auto-sent reminder to ${email.to} (${email.status})`)
      }
    } catch (err) {
      console.error('[autonomy] sweep failed:', err.message)
    }
  })
}
