import mongoose from 'mongoose';
import Brand from '../models/Brand.js';
import Product from '../models/Product.js';

const brands = [
  {
    name: 'BakeHouse',
    description: 'Premium bakery products with authentic taste and quality ingredients'
  },
  {
    name: 'SweetTreats', 
    description: 'Delicious confectionery and sweet bakery items for every occasion'
  },
  {
    name: 'CookieKing',
    description: 'Specialist in cookies, biscuits and crunchy baked goods'
  },
  {
    name: 'BreadBuddy',
    description: 'Fresh bread, buns and daily bakery essentials'
  },
  {
    name: 'OvenFresh',
    description: 'Artisanal baked goods made fresh daily with traditional methods'
  }
];

const productTemplates = [
  // BakeHouse Products
  { name: 'Chocolate Cup Cakes - 6 Nos', price: 150, image: 'choco-cupcakes.jpg', description: 'Rich chocolate cupcakes with creamy frosting' },
  { name: 'Vanilla Sponge Cake - 500g', price: 220, image: 'vanilla-cake.jpg', description: 'Light and fluffy vanilla sponge cake' },
  { name: 'Red Velvet Cake - 1kg', price: 450, image: 'red-velvet.jpg', description: 'Classic red velvet cake with cream cheese frosting' },
  { name: 'Blueberry Muffins - 4 Nos', price: 120, image: 'blueberry-muffins.jpg', description: 'Fresh blueberry muffins baked to perfection' },
  { name: 'Chocolate Brownie - 250g', price: 180, image: 'chocolate-brownie.jpg', description: 'Fudgy chocolate brownies with nuts' },
  { name: 'Lemon Drizzle Cake - 400g', price: 200, image: 'lemon-cake.jpg', description: 'Zesty lemon cake with sweet glaze' },

  // SweetTreats Products  
  { name: 'Strawberry Tart - 2 Nos', price: 140, image: 'strawberry-tart.jpg', description: 'Fresh strawberry tarts with custard filling' },
  { name: 'Chocolate Eclair - 3 Nos', price: 160, image: 'chocolate-eclair.jpg', description: 'Classic eclairs filled with cream and chocolate' },
  { name: 'Apple Pie - 500g', price: 250, image: 'apple-pie.jpg', description: 'Traditional apple pie with cinnamon and spices' },
  { name: 'Donuts Assorted - 6 Nos', price: 180, image: 'assorted-donuts.jpg', description: 'Mixed flavour donuts with glazes and toppings' },
  { name: 'Custard Pastry - 4 Nos', price: 130, image: 'custard-pastry.jpg', description: 'Flaky pastry filled with vanilla custard' },
  { name: 'Fruit Cake - 750g', price: 320, image: 'fruit-cake.jpg', description: 'Rich fruit cake with nuts and dried fruits' },

  // CookieKing Products
  { name: 'Chocolate Chip Cookies - 200g', price: 120, image: 'choco-chip-cookies.jpg', description: 'Crispy chocolate chip cookies in pack' },
  { name: 'Oatmeal Cookies - 250g', price: 110, image: 'oatmeal-cookies.jpg', description: 'Healthy oatmeal cookies with raisins' },
  { name: 'Butter Cookies - 300g', price: 140, image: 'butter-cookies.jpg', description: 'Classic butter cookies in elegant packaging' },
  { name: 'Ginger Snap Cookies - 200g', price: 100, image: 'ginger-snap.jpg', description: 'Spicy ginger snap cookies with molasses' },
  { name: 'Sugar Cookies - 250g', price: 95, image: 'sugar-cookies.jpg', description: 'Sweet and simple sugar cookies' },
  { name: 'Chocolate Wafers - 180g', price: 85, image: 'choco-wafers.jpg', description: 'Thin chocolate wafer cookies' },

  // BreadBuddy Products
  { name: 'White Bread Loaf - 400g', price: 45, image: 'white-bread.jpg', description: 'Fresh white bread loaf baked daily' },
  { name: 'Whole Wheat Bread - 450g', price: 55, image: 'wheat-bread.jpg', description: 'Nutritious whole wheat bread' },
  { name: 'Burger Buns - 6 Nos', price: 60, image: 'burger-buns.jpg', description: 'Soft burger buns perfect for sandwiches' },
  { name: 'Dinner Rolls - 8 Nos', price: 70, image: 'dinner-rolls.jpg', description: 'Small soft dinner rolls for meals' },
  { name: 'Garlic Bread - 300g', price: 90, image: 'garlic-bread.jpg', description: 'Herbed garlic bread with butter' },
  { name: 'French Baguette - 250g', price: 80, image: 'french-baguette.jpg', description: 'Crispy French baguette with soft interior' },

  // OvenFresh Products
  { name: 'Croissant - 4 Nos', price: 160, image: 'croissant.jpg', description: 'Buttery flaky croissants made fresh' },
  { name: 'Danish Pastry - 3 Nos', price: 140, image: 'danish-pastry.jpg', description: 'Sweet Danish pastries with fruit filling' },
  { name: 'Pretzel - 2 Nos', price: 80, image: 'pretzel.jpg', description: 'Traditional salted pretzels' },
  { name: 'Cinnamon Roll - 4 Nos', price: 180, image: 'cinnamon-roll.jpg', description: 'Warm cinnamon rolls with glaze' },
  { name: 'Pain au Chocolat - 3 Nos', price: 170, image: 'pain-chocolat.jpg', description: 'Chocolate filled croissants' },
  { name: 'Cheese Straws - 150g', price: 120, image: 'cheese-straws.jpg', description: 'Savory cheese pastry straws' }
];

export const seedBrandsAndProducts = async () => {
  try {
    console.log('🌱 Starting Brand and Product seeding...');
    
    // Connect to MongoDB if not connected
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect('mongodb+srv://jeeturadicalloop:Mjvesqnj8gY3t0zP@cluster0.by2xy6x.mongodb.net/manuerp');
    }

    // Clear existing data
    await Brand.deleteMany({});
    await Product.deleteMany({});
    console.log('🗑️ Cleared existing brands and products');

    // Insert brands
    const insertedBrands = await Brand.insertMany(brands);
    console.log(`✅ Inserted ${insertedBrands.length} brands`);

    // Prepare products with brand assignments
    const products = [];
    const productsPerBrand = Math.ceil(productTemplates.length / insertedBrands.length);
    
    insertedBrands.forEach((brand, brandIndex) => {
      const startIndex = brandIndex * productsPerBrand;
      const endIndex = Math.min(startIndex + productsPerBrand, productTemplates.length);
      
      for (let i = startIndex; i < endIndex; i++) {
        if (productTemplates[i]) {
          products.push({
            ...productTemplates[i],
            brandId: brand._id
          });
        }
      }
    });

    // Insert products
    const insertedProducts = await Product.insertMany(products);
    console.log(`✅ Inserted ${insertedProducts.length} products`);

    // Display summary
    console.log('\n📊 SEEDING SUMMARY:');
    console.log('==================');
    for (const brand of insertedBrands) {
      const productCount = await Product.countDocuments({ brandId: brand._id });
      console.log(`${brand.name}: ${productCount} products`);
    }

    console.log('\n🎉 Brand and Product seeding completed successfully!');
    return true;

  } catch (error) {
    console.error('❌ Error seeding brands and products:', error);
    throw error;
  }
};

// Run seeding if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedBrandsAndProducts()
    .then(() => {
      console.log('✅ Seeding completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Seeding failed:', error);
      process.exit(1);
    });
}