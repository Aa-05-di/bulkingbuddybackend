const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const orderedItemSchema = new mongoose.Schema({
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Item",
        required: true,
    },
    quantity: { type: Number, required: true },
    priceAtPurchase: { type: Number, required: true }
}, { _id: false });

const orderSchema = new mongoose.Schema({
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    items: [orderedItemSchema],
    totalAmount: { type: Number, required: true },
    status: { type: String, default: 'Pending' },
    deliveryLocation: { type: String, default: null },
    deliveryMethod: {
      type: String,
      required: true,
      enum: ['Delivery', 'Pickup'],
      default: 'Delivery'
    },
},
{
    // This correctly adds createdAt and updatedAt fields to all new orders.
    timestamps: true 
});

module.exports = mongoose.model("Order", orderSchema);

