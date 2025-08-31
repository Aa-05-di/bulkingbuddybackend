const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");

const User = require("./userSchema");
const Item = require("./ItemSchema");
const Order = require("./orderSchema");

dotenv.config();

const app = express();
const port = 8000;

// Middleware
app.use(cors());
app.use(express.json());

// DB
mongoose
  .connect(`mongodb+srv://aadithyanlearn:${process.env.MONGO}@cluster0.dhupojt.mongodb.net/RegList`)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("Connection failed:", err));

// ---------- Auth ----------
app.post("/register", async (req, res) => {
  try {
    const { username, email, password, location } = req.body;
    if (!username || !email || !password || !location) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(409).json({ message: "Email already exists" });

    const newUser = new User({ username, email, password, location });
    await newUser.save();
    res.status(200).json({ message: "User registered successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error registering user", error });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: "User not found" });
    if (user.password !== password) return res.status(401).json({ message: "Incorrect password" });

    return res.status(200).json({
      message: "Login successful",
      username: user.username,
      email: user.email,
      location: user.location,
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
});

// ---------- Items ----------
app.post("/additem", async (req, res) => {
  const { photo, itemname, price, protein, seller, location } = req.body;
  if (!itemname || price == null || !protein || !location) {
    return res.status(400).json({ message: "Required fields are missing" });
  }

  try {
    const newItem = new Item({ photo, itemname, price, protein, seller, location });
    await newItem.save();
    res.status(200).json({ message: "Item added successfully", item: newItem });
  } catch (e) {
    console.error("Add item error:", e);
    res.status(500).json({ message: "Server error while adding item" });
  }
});

// ---------- Cart Helpers ----------
async function getPopulatedCartByEmail(email) {
  const user = await User.findOne({ email }).populate("cart.productId");
  if (!user) return null;
  return { user, cart: user.cart };
}

// Add to cart (+=1 if exists, else push)
app.post("/addtocart", async (req, res) => {
  const { email, itemId } = req.body;

  if (!email || !itemId) {
    return res.status(400).json({ message: "Email and Item ID are required" });
  }

  try {
    // Ensure item exists
    const item = await Item.findById(itemId);
    if (!item) return res.status(404).json({ message: "Item not found" });

    // Try to increment existing entry
    const incResult = await User.updateOne(
      { email, "cart.productId": itemId },
      { $inc: { "cart.$.quantity": 1 } }
    );

    if (incResult.modifiedCount === 0) {
      // Not found -> push a new cart line
      await User.updateOne(
        { email },
        { $push: { cart: { productId: itemId, quantity: 1 } } }
      );
    }

    const data = await getPopulatedCartByEmail(email);
    if (!data) return res.status(404).json({ message: "User not found" });

    res.status(200).json({
      message: "Cart updated successfully",
      cart: data.cart,
    });
  } catch (e) {
    console.error("Add to cart error:", e);
    res.status(500).json({ message: "Server error updating cart" });
  }
});

// Remove one line completely from cart
app.post("/removefromcart", async (req, res) => {
  const { email, itemId } = req.body;
  if (!email || !itemId) {
    return res.status(400).json({ message: "Email and Item ID are required" });
  }

  try {
    const user = await User.findOneAndUpdate(
      { email },
      { $pull: { cart: { productId: itemId } } },
      { new: true }
    ).populate("cart.productId");

    if (!user) return res.status(404).json({ message: "User not found" });

    res.status(200).json({
      message: "Item fully removed from cart",
      cart: user.cart,
    });
  } catch (e) {
    console.error("Remove from cart error:", e);
    res.status(500).json({ message: "Server error removing item from cart" });
  }
});

// Set quantity (if <=0 -> remove line)
app.post("/updatecartquantity", async (req, res) => {
  const { email, itemId, newQuantity } = req.body;

  if (!email || !itemId || newQuantity == null) {
    return res.status(400).json({ message: "Email, Item ID and newQuantity are required" });
  }

  try {
    if (newQuantity <= 0) {
      const user = await User.findOneAndUpdate(
        { email },
        { $pull: { cart: { productId: itemId } } },
        { new: true }
      ).populate("cart.productId");
      if (!user) return res.status(404).json({ message: "User not found" });
      return res.status(200).json({ message: "Item removed from cart", cart: user.cart });
    }

    const user = await User.findOneAndUpdate(
      { email, "cart.productId": itemId },
      { $set: { "cart.$.quantity": newQuantity } },
      { new: true }
    ).populate("cart.productId");

    if (!user) return res.status(404).json({ message: "User not found" });

    const exists = user.cart.find(
      (c) => c.productId && c.productId._id.toString() === itemId
    );
    if (!exists) {
      const user2 = await User.findOneAndUpdate(
        { email },
        { $push: { cart: { productId: itemId, quantity: newQuantity } } },
        { new: true }
      ).populate("cart.productId");

      return res.status(200).json({
        message: "Quantity set successfully",
        cart: user2.cart,
      });
    }

    res.status(200).json({ message: "Quantity updated successfully", cart: user.cart });
  } catch (e) {
    console.error("Update quantity error:", e);
    res.status(500).json({ message: "Server error updating quantity" });
  }
});

// ---------- Checkout ----------
app.post("/placeorder", async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }
  try {
    const user = await User.findOne({ email }).populate("cart.productId");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.cart.length === 0) {
      return res.status(400).json({ message: "Cart is empty" });
    }

    let totalAmount = 0;
    const itemsForOrder = user.cart.map(cartItem => {
      const price = parseFloat(cartItem.productId.price);
      totalAmount += price * cartItem.quantity;
      return {
        productId: cartItem.productId._id,
        quantity: cartItem.quantity,
        priceAtPurchase: price
      };
    });

    const newOrder = new Order({
      user: user._id,
      items: itemsForOrder,
      totalAmount: totalAmount,
    });
    await newOrder.save();

    await User.updateOne(
      { email },
      { $set: { cart: [] } }
    );

    res.status(200).json({
      message: "Order placed and cart cleared successfully",
      orderId: newOrder._id,
    });

  } catch (e) {
    console.error("Place order error:", e);
    res.status(500).json({ message: "Server error placing order" });
  }
});

// New endpoint for a seller to accept an order
app.post("/acceptorder", async (req, res) => {
  const { orderId } = req.body;

  if (!orderId) {
    return res.status(400).json({ message: "Order ID is required" });
  }

  try {
    const updatedOrder = await Order.findByIdAndUpdate(
      orderId,
      { $set: { status: "Accepted" } },
      { new: true }
    ).populate("user");

    if (!updatedOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.status(200).json({
      message: "Order accepted successfully",
      order: updatedOrder,
    });
  } catch (e) {
    console.error("Accept order error:", e);
    res.status(500).json({ message: "Server error accepting order" });
  }
});

// New endpoint for a buyer to send their delivery location
app.post("/sendlocation", async (req, res) => {
  const { orderId, location } = req.body;

  if (!orderId || !location) {
    return res.status(400).json({ message: "Order ID and location are required" });
  }

  try {
    const updatedOrder = await Order.findByIdAndUpdate(
      orderId,
      { $set: { deliveryLocation: location } },
      { new: true }
    );

    if (!updatedOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.status(200).json({
      message: "Location sent successfully",
      order: updatedOrder,
    });
  } catch (e) {
    console.error("Send location error:", e);
    res.status(500).json({ message: "Server error sending location" });
  }
});


// ---------- Orders ----------
// ----- ADDED FOR PENDING COUNT -----
// New lightweight endpoint to get only the count of pending orders
app.get("/receivedorders/pending-count/:sellerEmail", async (req, res) => {
  const { sellerEmail } = req.params;
  if (!sellerEmail) {
    return res.status(400).json({ message: "Seller email is required" });
  }
  try {
    const sellerItems = await Item.find({ seller: sellerEmail }, '_id');
    if (sellerItems.length === 0) {
      return res.status(200).json({ count: 0 });
    }
    const sellerItemIds = sellerItems.map(item => item._id);

    const count = await Order.countDocuments({
      "items.productId": { $in: sellerItemIds },
      "status": "Pending",
    });

    res.status(200).json({ count });
  } catch (e) {
    console.error("Fetch pending order count error:", e);
    res.status(500).json({ message: "Server error fetching pending order count" });
  }
});
// ----- END OF ADDED SECTION -----

app.get("/receivedorders/:sellerEmail", async (req, res) => {
  const sellerEmail = req.params.sellerEmail;

  if (!sellerEmail) {
    return res.status(400).json({ message: "Seller email is required" });
  }

  try {
    const seller = await User.findOne({ email: sellerEmail });
    if (!seller) {
      console.log(`Seller not found for email: ${sellerEmail}`);
      return res.status(404).json({ message: "Seller not found" });
    }

    const sellerItems = await Item.find({ seller: sellerEmail });
    if (sellerItems.length === 0) {
      console.log(`No items found for seller email: ${sellerEmail}`);
      return res.status(200).json([]);
    }

    const sellerItemIds = sellerItems.map(item => item._id);
    console.log(`Found item IDs for seller: ${sellerItemIds}`);

    const receivedOrders = await Order.find({
      "items.productId": { $in: sellerItemIds },
    }).populate("user").populate("items.productId");

    console.log(`Found ${receivedOrders.length} received orders.`);

    res.status(200).json(receivedOrders);

  } catch (e) {
    console.error("Fetch received orders error:", e);
    res.status(500).json({ message: "Server error fetching received orders" });
  }
});

app.get("/userorders/:userEmail", async (req, res) => {
  const userEmail = req.params.userEmail;

  if (!userEmail) {
    return res.status(400).json({ message: "User email is required" });
  }

  try {
    const user = await User.findOne({ email: userEmail });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const userOrders = await Order.find({ user: user._id })
      .populate("items.productId");

    res.status(200).json(userOrders);
  } catch (e) {
    console.error("Fetch user orders error:", e);
    res.status(500).json({ message: "Server error fetching user orders" });
  }
});


// ---------- Profile ----------
app.get("/profile/:email", async (req, res) => {
  const email = req.params.email;
  try {
    const user = await User.findOne({ email }).populate("cart.productId");
    if (!user) return res.status(404).json({ message: "User not found" });

    // Find nearby items, but exclude items sold by the current user
    const nearbyItems = await Item.find({
      location: user.location,
      seller: { $ne: email } // This is the new filter
    });

    res.status(200).json({
      username: user.username,
      email: user.email,
      location: user.location,
      cart: user.cart,
      nearbyItems,
    });
  } catch (e) {
    console.error("Fetch profile error:", e);
    res.status(500).json({ message: "Server error fetching profile" });
  }
});

app.listen(port, () => console.log(`Server running on port ${port}`));