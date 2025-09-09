const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const User = require("./UserSchema");
const Item = require("./ItemSchema");
const Order = require("./OrderSchema");
const { GoogleGenerativeAI } = require("@google/generative-ai");

dotenv.config();

const app = express();
const port = process.env.PORT || 8000; 

// Middleware
app.use(cors());
app.use(express.json());

// DB
mongoose
  .connect(`mongodb+srv://aadithyanlearn:${process.env.MONGO}@cluster0.dhupojt.mongodb.net/RegList`)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("Connection failed:", err));

// ... (No changes in Auth, Items, Cart, Checkout, or Send Location sections)

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
  // Now accepts 'quantity'
  const { photo, itemname, price, protein, seller, location, quantity } = req.body;
  if (!itemname || price == null || !protein || !location || quantity == null) {
    return res.status(400).json({ message: "All fields including quantity are required" });
  }

  try {
    const newItem = new Item({ photo, itemname, price, protein, seller, location, quantity });
    await newItem.save();
    res.status(200).json({ message: "Item added successfully", item: newItem });
  } catch (e) {
    console.error("Add item error:", e);
    res.status(500).json({ message: "Server error while adding item" });
  }
});

app.post("/orders/deliver/:orderId", async (req, res) => {
  const { orderId } = req.params;
  if (!orderId) {
    return res.status(400).json({ message: "Order ID is required" });
  }
  try {
    const updatedOrder = await Order.findByIdAndUpdate(
      orderId,
      { $set: { status: "Delivered" } },
      { new: true }
    );
    if (!updatedOrder) {
      return res.status(404).json({ message: "Order not found" });
    }
    res.status(200).json({ message: "Order marked as delivered." });
  } catch (e) {
    console.error("Deliver order error:", e);
    res.status(500).json({ message: "Server error updating order status" });
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
  const { email, deliveryMethod } = req.body;
  if (!email || !deliveryMethod) {
    return res.status(400).json({ message: "Email and delivery method are required" });
  }
  try {
    const user = await User.findOne({ email }).populate("cart.productId");
    if (!user || user.cart.length === 0) {
      return res.status(400).json({ message: "User or cart not found" });
    }

    // 1. Verify stock for all items BEFORE creating the order
    for (const cartItem of user.cart) {
      const itemInDb = await Item.findById(cartItem.productId._id);
      if (!itemInDb || itemInDb.quantity < cartItem.quantity) {
        return res.status(400).json({
          message: `Not enough stock for ${cartItem.productId.itemname}. Only ${itemInDb.quantity} left.`,
        });
      }
    }

    // 2. If stock is sufficient, proceed to decrement quantities and create order
    const deliveryCharge = 20.0;
    let itemsTotal = 0;
    const itemsForOrder = [];

    for (const cartItem of user.cart) {
      const price = parseFloat(cartItem.productId.price);
      itemsTotal += price * cartItem.quantity;
      itemsForOrder.push({
        productId: cartItem.productId._id,
        quantity: cartItem.quantity,
        priceAtPurchase: price,
      });

      // Decrement the stock in the database
      await Item.updateOne(
        { _id: cartItem.productId._id },
        { $inc: { quantity: -cartItem.quantity } }
      );
    }

    const finalTotalAmount = deliveryMethod === 'Delivery' ? itemsTotal + deliveryCharge : itemsTotal;

    const newOrder = new Order({
      user: user._id,
      items: itemsForOrder,
      totalAmount: finalTotalAmount,
      deliveryMethod: deliveryMethod,
    });
    await newOrder.save();

    await User.updateOne({ email }, { $set: { cart: [] } });
    res.status(200).json({ message: "Order placed successfully" });

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

app.get("/receivedorders/:sellerEmail", async (req, res) => {
  const { sellerEmail } = req.params;
  try {
    // ... (code to find seller and items is unchanged)
    const seller = await User.findOne({ email: sellerEmail });
    if (!seller) return res.status(404).json({ message: "Seller not found" });
    const sellerItems = await Item.find({ seller: sellerEmail });
    if (sellerItems.length === 0) return res.status(200).json([]);
    const sellerItemIds = sellerItems.map(item => item._id);

    // This query now only finds orders with 'Pending' or 'Accepted' status
    const receivedOrders = await Order.find({
      "items.productId": { $in: sellerItemIds },
      "status": { $in: ["Pending", "Accepted"] }
    })
    .sort({ createdAt: -1 })
    .populate("user").populate("items.productId");

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
      .sort({ createdAt: -1 }) // Changed from createdAt to orderDate
      .populate("items.productId");

    res.status(200).json(userOrders);
  } catch (e) {
    console.error("Fetch user orders error:", e);
    res.status(500).json({ message: "Server error fetching user orders" });
  }
});

// ----- THIS IS THE TEMPORARY DEBUG ROUTE -----
app.get("/debug/latest-order/:userEmail", async (req, res) => {
  const { userEmail } = req.params;
  try {
    const user = await User.findOne({ email: userEmail });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    const latestOrder = await Order.findOne({ user: user._id })
      .sort({ orderDate: -1 }) // Changed from createdAt to orderDate
      .populate("items.productId");
    if (!latestOrder) {
      return res.status(404).json({ message: "No orders found for this user at all." });
    }
    res.status(200).json(latestOrder);
  } catch (e) {
    res.status(500).json({ error: e.toString() });
  }
});

// ---------- Profile ----------
app.get("/profile/:email", async (req, res) => {
  const email = req.params.email;
  try {
    const user = await User.findOne({ email }).populate("cart.productId");
    if (!user) return res.status(404).json({ message: "User not found" });

    const nearbyItems = await Item.find({
      location: user.location,
      seller: { $ne: email },
      quantity: { $gt: 0 },
    });

    res.status(200).json({
      username: user.username,
      email: user.email,
      location: user.location,
      cart: user.cart,
      nearbyItems,
      workoutSplit: user.workoutSplit,
    });
  } catch (e) {
    console.error("Fetch profile error:", e);
    res.status(500).json({ message: "Server error fetching profile" });
  }
});

app.get("/orders/proteintoday/:userEmail", async (req, res) => {
  const { userEmail } = req.params;
  if (!userEmail) {
    return res.status(400).json({ message: "User email is required" });
  }

  try {
    const user = await User.findOne({ email: userEmail });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));

    const todaysOrders = await Order.find({
      user: user._id,
      createdAt: { $gte: startOfDay, $lt: endOfDay }, 
    }).populate("items.productId");

    let totalProteinToday = 0;
    for (const order of todaysOrders) {
      for (const item of order.items) {
        if (item.productId && item.productId.protein) {
          const proteinValue = parseInt(item.productId.protein.replace(/[^0-9]/g, ''), 10) || 0;
          totalProteinToday += proteinValue * item.quantity;
        }
      }
    }
    
    res.status(200).json({ totalProteinToday });

  } catch (e) {
    console.error("Fetch protein today error:", e);
    res.status(500).json({ message: "Server error fetching protein data" });
  }
});

app.post("/update-workout-split", async (req, res) => {
  const { email, newSplit } = req.body;
  if (!email || !newSplit) {
    return res.status(400).json({ message: "Email and newSplit are required" });
  }
  try {
    const user = await User.findOneAndUpdate(
      { email },
      { $set: { workoutSplit: newSplit } },
      { new: true } // Return the updated document
    );
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({ 
        message: "Workout split updated successfully", 
        workoutSplit: user.workoutSplit 
    });
  } catch (e) {
    console.error("Update workout split error:", e);
    res.status(500).json({ message: "Server error updating workout split" });
  }
});

// ---------- AI Workout Planner ----------
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post("/generate-workout", async (req, res) => {
  // Now accepts an optional 'eatenFood' string
  const { weight, proteinToday, userEmail, eatenFood } = req.body; 

  if (!weight || proteinToday == null || !userEmail) {
    return res.status(400).json({ message: "Weight, protein, and userEmail are required" });
  }
  try {
    const user = await User.findOne({ email: userEmail });
    if (!user) return res.status(404).json({ message: "User not found" });

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const today = new Date().getDay();
    const dayOfWeek = days[today];
    const targetMuscleGroup = user.workoutSplit.get(dayOfWeek);
    
    if (targetMuscleGroup === 'Rest') {
      // ... (Rest day logic is unchanged)
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

    // The prompt is now much more powerful
    const prompt = `
      You are "Bulking Buddy," a helpful and motivating fitness coach.
      A user who weighs ${weight} kg has already purchased food containing ${proteinToday}g of protein today.
      They have also manually entered other food they have eaten: "${eatenFood || 'nothing'}".
      Their daily protein goal is approximately ${weight * 2}g.
      Today is ${dayOfWeek}, which is their "${targetMuscleGroup} Day."

      Perform the following steps:
      1. First, estimate the total grams of protein from the manually entered food: "${eatenFood || 'nothing'}".
      2. Add this estimated protein to the ${proteinToday}g they already purchased to get a new total protein intake for the day.
      3. Based on this new total protein intake, generate a workout plan that focuses exclusively on ${targetMuscleGroup} exercises. The intensity (sets/reps) should reflect their total protein intake.
      
      Your response MUST be a valid JSON object with NO extra text or markdown formatting.
      The JSON object must have three keys:
      1. "estimatedProtein": A number representing your estimate of the protein from the manually entered food.
      2. "fact": A short, encouraging fact (string) that refers to their NEW TOTAL protein intake and relates it to their ${targetMuscleGroup} workout potential.
      3. "exercises": An array of JSON objects for the ${targetMuscleGroup} workout. Each object must have "name", "sets", and "reps" keys.
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    const cleanJsonText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const workoutPlan = JSON.parse(cleanJsonText);

    res.status(200).json(workoutPlan);

  } catch (e) {
    console.error("Gemini API error:", e);
    res.status(500).json({ message: "Error generating workout plan from AI." });
  }
});

app.listen(port, '0.0.0.0', () => console.log(`Server running on port ${port}`));