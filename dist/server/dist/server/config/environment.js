"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
// Load environment-specific config
const nodeEnv = process.env.NODE_ENV || 'development';
if (nodeEnv === 'production') {
    dotenv_1.default.config({ path: '.env.production' });
}
else {
    dotenv_1.default.config(); // defaults to .env
}
exports.config = {
    // Environment
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: parseInt(process.env.PORT || '5000', 10),
    // Database
    MONGODB_URI: process.env.MONGODB_URI || 'mongodb+srv://jeeturadicalloop:Mjvesqnj8gY3t0zP@cluster0.by2xy6x.mongodb.net/manuerp',
    // JWT
    JWT_SECRET: process.env.JWT_SECRET || 'fallback-secret-key',
    // CORS Origins
    CORS_ORIGINS: nodeEnv === 'production'
        ? ['https://sunrize.shrawantravels.com']
        : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:4173'],
    // API Base URL for frontend
    API_BASE_URL: process.env.VITE_API_BASE_URL || 'http://localhost:5000'
};
exports.default = exports.config;
