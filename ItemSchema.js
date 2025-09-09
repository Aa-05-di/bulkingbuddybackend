const mongoose = require("mongoose");

const itemSchema = new mongoose.Schema({
    photo:{
        type:String,
        required:false,
    },
    itemname:{
        type:String,
        required:true,
    },
    price:{
        type:String,
        required:true,
    },
    protein:{
        type:String,
        required:true
    },
    seller:{
        type:String,
    },
    location:{
        type:String,
        required:true,
    },
    quantity: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
})

module.exports = mongoose.model("Item",itemSchema);