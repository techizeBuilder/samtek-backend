"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProductsByBrand = exports.deleteProduct = exports.updateProduct = exports.createProduct = exports.getProductById = exports.getProducts = void 0;
const Product_js_1 = __importDefault(require("../models/Product.js"));
const Brand_js_1 = __importDefault(require("../models/Brand.js"));
// Get all products with filtering and pagination
const getProducts = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { brandId, search, page = 1, limit = 10 } = req.query;
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
        const products = yield Product_js_1.default.find(filter)
            .populate('brandId', 'name description')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));
        // Get total count for pagination
        const total = yield Product_js_1.default.countDocuments(filter);
        // Format response
        const formattedProducts = products.map(product => {
            var _a, _b;
            return ({
                _id: product._id,
                name: product.name,
                brand: ((_a = product.brandId) === null || _a === void 0 ? void 0 : _a.name) || 'Unknown Brand',
                brandId: (_b = product.brandId) === null || _b === void 0 ? void 0 : _b._id,
                price: product.price,
                image: `/uploads/products/${product.image}`,
                description: product.description,
                createdAt: product.createdAt
            });
        });
        res.json({
            success: true,
            products: formattedProducts,
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / parseInt(limit))
        });
    }
    catch (error) {
        console.error('Get products error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch products'
        });
    }
});
exports.getProducts = getProducts;
// Get single product
const getProductById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { id } = req.params;
        const product = yield Product_js_1.default.findById(id).populate('brandId', 'name description');
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }
        const formattedProduct = {
            _id: product._id,
            name: product.name,
            brand: ((_a = product.brandId) === null || _a === void 0 ? void 0 : _a.name) || 'Unknown Brand',
            brandId: (_b = product.brandId) === null || _b === void 0 ? void 0 : _b._id,
            price: product.price,
            image: `/uploads/products/${product.image}`,
            description: product.description,
            createdAt: product.createdAt
        };
        res.json({
            success: true,
            product: formattedProduct
        });
    }
    catch (error) {
        console.error('Get product error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch product'
        });
    }
});
exports.getProductById = getProductById;
// Create new product
const createProduct = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, brandId, price, description, image } = req.body;
        // Validate brand exists
        const brand = yield Brand_js_1.default.findById(brandId);
        if (!brand) {
            return res.status(400).json({
                success: false,
                message: 'Invalid brand selected'
            });
        }
        const product = new Product_js_1.default({
            name,
            brandId,
            price: parseFloat(price),
            description,
            image: image || 'default-product.jpg'
        });
        yield product.save();
        // Populate brand information for response
        yield product.populate('brandId', 'name description');
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
    }
    catch (error) {
        console.error('Create product error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create product'
        });
    }
});
exports.createProduct = createProduct;
// Update product
const updateProduct = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { id } = req.params;
        const { name, brandId, price, description, image } = req.body;
        // Validate brand exists if brandId is provided
        if (brandId) {
            const brand = yield Brand_js_1.default.findById(brandId);
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
        const product = yield Product_js_1.default.findByIdAndUpdate(id, updateData, { new: true, runValidators: true }).populate('brandId', 'name description');
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }
        const formattedProduct = {
            _id: product._id,
            name: product.name,
            brand: ((_a = product.brandId) === null || _a === void 0 ? void 0 : _a.name) || 'Unknown Brand',
            brandId: (_b = product.brandId) === null || _b === void 0 ? void 0 : _b._id,
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
    }
    catch (error) {
        console.error('Update product error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update product'
        });
    }
});
exports.updateProduct = updateProduct;
// Delete product
const deleteProduct = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const product = yield Product_js_1.default.findByIdAndDelete(id);
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
    }
    catch (error) {
        console.error('Delete product error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete product'
        });
    }
});
exports.deleteProduct = deleteProduct;
// Get products by brand
const getProductsByBrand = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { brandId } = req.params;
        const products = yield Product_js_1.default.find({ brandId })
            .populate('brandId', 'name description')
            .sort({ name: 1 });
        const formattedProducts = products.map(product => {
            var _a, _b;
            return ({
                _id: product._id,
                name: product.name,
                brand: ((_a = product.brandId) === null || _a === void 0 ? void 0 : _a.name) || 'Unknown Brand',
                brandId: (_b = product.brandId) === null || _b === void 0 ? void 0 : _b._id,
                price: product.price,
                image: `/uploads/products/${product.image}`,
                description: product.description
            });
        });
        res.json({
            success: true,
            products: formattedProducts
        });
    }
    catch (error) {
        console.error('Get products by brand error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch products by brand'
        });
    }
});
exports.getProductsByBrand = getProductsByBrand;
