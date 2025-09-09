const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const orderedItemSchema = new mongoose.Schema({
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Item",
        required: true,
    },
    quantity: {
        type: Number,
        required: true,
    },
    priceAtPurchase: {
        type: Number,
        required: true,
    }
}, { _id: false });

const orderSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    items: [orderedItemSchema],
    totalAmount: {
        type: Number,
        required: true,
    },
    orderDate: {
        type: Date,
        default: Date.now,
    },
    status: {
        type: String,
        enum: ['Pending', 'Accepted', 'Delivered'],
        default: 'Pending',
    },
    deliveryLocation: {
        type: String,
        default: null,
    },

    deliveryMethod: {
      type: String,
      required: true,
      enum: ['Delivery', 'Pickup'],
      default: 'Delivery'
    },
    timestamps: true
});

module.exports = mongoose.model("Order", orderSchema);

