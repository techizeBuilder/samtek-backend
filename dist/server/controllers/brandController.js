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
exports.deleteBrand = exports.updateBrand = exports.createBrand = exports.getBrands = void 0;
const Brand_js_1 = __importDefault(require("../models/Brand.js"));
// Get all brands
const getBrands = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const brands = yield Brand_js_1.default.find({}).sort({ name: 1 });
        res.json({
            success: true,
            brands
        });
    }
    catch (error) {
        console.error('Get brands error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch brands'
        });
    }
});
exports.getBrands = getBrands;
// Create new brand
const createBrand = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, description } = req.body;
        // Check if brand already exists
        const existingBrand = yield Brand_js_1.default.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });
        if (existingBrand) {
            return res.status(400).json({
                success: false,
                message: 'Brand with this name already exists'
            });
        }
        const brand = new Brand_js_1.default({ name, description });
        yield brand.save();
        res.status(201).json({
            success: true,
            message: 'Brand created successfully',
            brand
        });
    }
    catch (error) {
        console.error('Create brand error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create brand'
        });
    }
});
exports.createBrand = createBrand;
// Update brand
const updateBrand = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { name, description } = req.body;
        const brand = yield Brand_js_1.default.findByIdAndUpdate(id, { name, description }, { new: true, runValidators: true });
        if (!brand) {
            return res.status(404).json({
                success: false,
                message: 'Brand not found'
            });
        }
        res.json({
            success: true,
            message: 'Brand updated successfully',
            brand
        });
    }
    catch (error) {
        console.error('Update brand error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update brand'
        });
    }
});
exports.updateBrand = updateBrand;
// Delete brand
const deleteBrand = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const brand = yield Brand_js_1.default.findByIdAndDelete(id);
        if (!brand) {
            return res.status(404).json({
                success: false,
                message: 'Brand not found'
            });
        }
        res.json({
            success: true,
            message: 'Brand deleted successfully'
        });
    }
    catch (error) {
        console.error('Delete brand error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete brand'
        });
    }
});
exports.deleteBrand = deleteBrand;
