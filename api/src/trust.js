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
  // origin: 'reminder' scopes this to overnight drafts the owner actually
  // approved/edited/dismissed — without it, any interactively-composed chat
  // email (send_email is HITL-approved but never marked editedByOwner, since
  // the middleware substitutes edited args before the tool ever sees them)
  // counted as an "untouched approval" too, letting unrelated chat activity
  // unlock unsupervised auto-send.
  const recent = await Email.find({
    userId,
    origin: 'reminder',
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
    // How many reminder decisions are actually on record (0–TRUST_WINDOW). This
    // is NOT the rule's window size — that's the exported TRUST_WINDOW. The two
    // were confused once already in the autonomy refusal message.
    decisions: recent.length,
    clean,
    edited,
    skipped,
    cleanNeeded: TRUST_CLEAN_NEEDED,
    eligible,
    autoSendReminders: Boolean(user?.autonomy?.autoSendReminders),
  }
}
