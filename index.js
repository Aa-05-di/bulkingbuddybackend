const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");

const User = require("./userSchema");
const Item = require("./itemSchema");

dotenv.config();

const app = express();
const port = 8000;

// Middleware
app.use(cors());
app.use(express.json()); // no need for body-parser

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
      // Remove the entry
      const user = await User.findOneAndUpdate(
        { email },
        { $pull: { cart: { productId: itemId } } },
        { new: true }
      ).populate("cart.productId");

      if (!user) return res.status(404).json({ message: "User not found" });
      return res.status(200).json({ message: "Item removed from cart", cart: user.cart });
    }

    // Update the quantity using positional operator
    const user = await User.findOneAndUpdate(
      { email, "cart.productId": itemId },
      { $set: { "cart.$.quantity": newQuantity } },
      { new: true }
    ).populate("cart.productId");

    if (!user) return res.status(404).json({ message: "User not found" });

    // If no line existed, create it with the specified quantity
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

// ---------- Profile ----------
app.get("/profile/:email", async (req, res) => {
  const email = req.params.email;
  try {
    const user = await User.findOne({ email }).populate("cart.productId");
    if (!user) return res.status(404).json({ message: "User not found" });

    const nearbyItems = await Item.find({ location: user.location });

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
