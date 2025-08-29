const mongoose = require("mongoose");

const cartItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Item",
      required: true,
    },
    quantity: {
      type: Number,
      min: 1,
      default: 1,
      required: true,
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, minLength: 3 },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true, minLength: 6 },
    location: { type: String },
    cart: [cartItemSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
