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
  }
}

export const User = mongoose.model('User', userSchema)
