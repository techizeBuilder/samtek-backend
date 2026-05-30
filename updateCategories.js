const mongoose = require('mongoose');
require('dotenv').config();

// Define the schema inline
const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  description: { type: String, trim: true },
  subcategories: [{ type: String, trim: true }]
}, { timestamps: true });

const Category = mongoose.model('Category', categorySchema);

const newCategories = [
  {
    name: "Purchase Machine",
    description: "बाहर से purchase की गई मशीनें",
    subcategories: ["Excavator", "Crane", "Loader", "Generator"]
  },
  {
    name: "Manufacturing Machine", 
    description: "जो मशीनें हम in-house manufacture करते हैं",
    subcategories: ["Flour Mill", "RPM Machine", "Cleaning Machine", "Spice Plant", "Pulverizer"]
  },
  {
    name: "Raw Material",
    description: "SS/MS sheet, pipe, angle, rod आदि raw material",
    subcategories: ["SS Sheet", "MS Sheet", "Pipe", "Angle", "Rod", "Wire"]
  },
  {
    name: "Tool",
    description: "welding, cutting, measuring एवं maintenance tools",
    subcategories: ["Welding Tools", "Cutting Tools", "Measuring Tools", "Maintenance Tools"]
  },
  {
    name: "Asset",
    description: "company fixed assets जैसे computer, generator, furniture आदि",
    subcategories: ["Computer", "Generator", "Furniture", "Vehicle", "Office Equipment"]
  },
  {
    name: "Sheet Metal Material (Job Work)",
    description: "drawing/design के अनुसार cut एवं fabricated sheet parts जो job work से आते हैं",
    subcategories: ["Chamber Parts", "Hopper Parts", "Belt Guard", "Cover Parts"]
  },
  {
    name: "Machining Material (Job Work)",
    description: "machining process वाले parts जैसे shaft, pulley, bush, coupling, bearing housing आदि",
    subcategories: ["Shaft", "Pulley", "Bush", "Coupling", "Bearing Housing"]
  },
  {
    name: "Child Part Material (Sub-Assembly Parts)",
    description: "frequently used fabricated ready parts जो पहले से prepare करके stock में रखे जाएंगे",
    subcategories: ["Machine Frame", "Cyclone", "Hopper", "Stand", "Chamber Assembly"]
  },
  {
    name: "Assembly Material (Bought-Out Fitting Items)",
    description: "ready-to-fit standard components जो direct machine assembly में लगते हैं",
    subcategories: ["Motor", "Bearing", "Nut Bolt", "Spring", "Gearbox", "Pulley", "Sensor", "Electrical Items"]
  }
];

async function updateCategories() {
  try {
    console.log('🔄 Starting category update...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('📦 Connected to MongoDB');
    
    // Clear existing categories (optional)
    await Category.deleteMany({});
    console.log('🗑️ Cleared existing categories');
    
    // Insert new categories
    const insertedCategories = await Category.insertMany(newCategories);
    
    console.log(`✅ Successfully updated ${insertedCategories.length} categories`);
    console.log('Categories added:');
    insertedCategories.forEach(category => {
      console.log(`- ${category.name}`);
      console.log(`  Subcategories: ${category.subcategories.join(', ')}`);
    });
    
    return insertedCategories;
  } catch (error) {
    console.error('❌ Error updating categories:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('📦 Disconnected from MongoDB');
  }
}

// Run update
updateCategories()
  .then(() => {
    console.log('🎉 Category update completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Category update failed:', error);
    process.exit(1);
  });