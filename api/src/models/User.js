import mongoose from 'mongoose'

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String }, // absent for Google-only accounts
    googleId: { type: String, index: true },
    name: { type: String, required: true, trim: true },
    businessName: { type: String, trim: true, default: '' },
    avatarUrl: { type: String, default: '' },
    isDemo: { type: Boolean, default: false },
    // guardrails for the client-facing concierge on public invoice pages
    concierge: {
      type: new mongoose.Schema(
        {
          enabled: { type: Boolean, default: true },
          maxExtensionDays: { type: Number, default: 14, min: 0, max: 90 },
          maxInstallments: { type: Number, default: 3, min: 1, max: 12 },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
  },
  { timestamps: true }
)

userSchema.methods.toSafeJSON = function () {
  return {
    id: this._id.toString(),
    email: this.email,
    name: this.name,
    businessName: this.businessName,
    avatarUrl: this.avatarUrl,
    isDemo: this.isDemo,
    hasGoogle: Boolean(this.googleId),
    concierge: {
      enabled: this.concierge?.enabled ?? true,
      maxExtensionDays: this.concierge?.maxExtensionDays ?? 14,
      maxInstallments: this.concierge?.maxInstallments ?? 3,
    },
  }
}

export const User = mongoose.model('User', userSchema)
