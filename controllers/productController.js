import Product from '../models/Product.js';
import Brand from '../models/Brand.js';

// Get all products with filtering and pagination
export const getProducts = async (req, res) => {
  try {
    const {
      brandId,
      search,
      page = 1,
      limit = 10
    } = req.query;

    // Build filter query
    const filter = {};
    
    if (brandId) {
      filter.brandId = brandId;
    }
    
    if (search) {
      filter.name = { $regex: search, $options: 'i' };
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get products with brand information
    const products = await Product.find(filter)
      .populate('brandId', 'name description')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const total = await Product.countDocuments(filter);

    // Format response
    const formattedProducts = products.map(product => ({
      _id: product._id,
      name: product.name,
      brand: product.brandId?.name || 'Unknown Brand',
      brandId: product.brandId?._id,
      price: product.price,
      image: `/uploads/products/${product.image}`,
      description: product.description,
      createdAt: product.createdAt
    }));

    res.json({
      success: true,
      products: formattedProducts,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch products'
    });
  }
};

// Get single product
export const getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findById(id).populate('brandId', 'name description');
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const formattedProduct = {
      _id: product._id,
      name: product.name,
      brand: product.brandId?.name || 'Unknown Brand',
      brandId: product.brandId?._id,
      price: product.price,
      image: `/uploads/products/${product.image}`,
      description: product.description,
      createdAt: product.createdAt
    };

    res.json({
      success: true,
      product: formattedProduct
    });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch product'
    });
  }
};

// Create new product
export const createProduct = async (req, res) => {
  try {
    const { name, brandId, price, description, image } = req.body;

    // Validate brand exists
    const brand = await Brand.findById(brandId);
    if (!brand) {
      return res.status(400).json({
        success: false,
        message: 'Invalid brand selected'
      });
    }

    const product = new Product({
      name,
      brandId,
      price: parseFloat(price),
      description,
      image: image || 'default-product.jpg'
    });

    await product.save();

    // Populate brand information for response
    await product.populate('brandId', 'name description');

    const formattedProduct = {
      _id: product._id,
      name: product.name,
      brand: product.brandId.name,
      brandId: product.brandId._id,
      price: product.price,
      image: `/uploads/products/${product.image}`,
      description: product.description,
      createdAt: product.createdAt
    };

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product: formattedProduct
    });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create product'
    });
  }
};

// Update product
export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, brandId, price, description, image } = req.body;

    // Validate brand exists if brandId is provided
    if (brandId) {
      const brand = await Brand.findById(brandId);
      if (!brand) {
        return res.status(400).json({
          success: false,
          message: 'Invalid brand selected'
        });
      }
    }

    const updateData = {
      name,
      brandId,
      price: parseFloat(price),
      description
    };

    if (image) {
      updateData.image = image;
    }

    const product = await Product.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('brandId', 'name description');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const formattedProduct = {
      _id: product._id,
      name: product.name,
      brand: product.brandId?.name || 'Unknown Brand',
      brandId: product.brandId?._id,
      price: product.price,
      image: `/uploads/products/${product.image}`,
      description: product.description,
      createdAt: product.createdAt
    };

    res.json({
      success: true,
      message: 'Product updated successfully',
      product: formattedProduct
    });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update product'
    });
  }
};

// Delete product
export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findByIdAndDelete(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete product'
    });
  }
};

// Get products by brand
export const getProductsByBrand = async (req, res) => {
  try {
    const { brandId } = req.params;

    const products = await Product.find({ brandId })
      .populate('brandId', 'name description')
      .sort({ name: 1 });

    const formattedProducts = products.map(product => ({
      _id: product._id,
      name: product.name,
      brand: product.brandId?.name || 'Unknown Brand',
      brandId: product.brandId?._id,
      price: product.price,
      image: `/uploads/products/${product.image}`,
      description: product.description
    }));

    res.json({
      success: true,
      products: formattedProducts
    });
  } catch (error) {
    console.error('Get products by brand error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch products by brand'
    });
  }
};