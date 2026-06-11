import { Email } from './models/Email.js'
import { User } from './models/User.js'

/**
 * Earned autonomy. Penny may only send reminders unsupervised once the owner's
 * recent decisions show they trust her drafts: in the last 10 reminder
 * decisions, at least 5 approved untouched and none skipped. Editing doesn't
 * break trust (taste ≠ distrust) — skipping does.
 */
export const TRUST_WINDOW = 10
export const TRUST_CLEAN_NEEDED = 5

export async function trustStats(userId) {
  const recent = await Email.find({
    userId,
    status: { $in: ['sent', 'simulated', 'dismissed'] },
  })
    .sort({ updatedAt: -1 })
    .limit(TRUST_WINDOW)
    .lean()

  const clean = recent.filter((e) => e.status !== 'dismissed' && !e.editedByOwner).length
  const edited = recent.filter((e) => e.status !== 'dismissed' && e.editedByOwner).length
  const skipped = recent.filter((e) => e.status === 'dismissed').length
  const eligible = clean >= TRUST_CLEAN_NEEDED && skipped === 0

  const user = await User.findById(userId)
  return {
    window: recent.length,
    clean,
    edited,
    skipped,
    cleanNeeded: TRUST_CLEAN_NEEDED,
    eligible,
    autoSendReminders: Boolean(user?.autonomy?.autoSendReminders),
  }
}
