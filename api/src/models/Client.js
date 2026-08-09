import mongoose from 'mongoose'

const clientSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true }, // company or person
    contactName: { type: String, trim: true, default: '' },
    // Optional (default ''), so validate the shape only when one is given —
    // unlike User.email this isn't required, and a bogus address here would
    // silently break send_email later (mirrors User.js's format check).
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
      validate: {
        validator: (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
        message: 'That does not look like a valid email address',
      },
    },
    phone: { type: String, trim: true, default: '' },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
)

clientSchema.index({ userId: 1, name: 1 })

export const Client = mongoose.model('Client', clientSchema)
