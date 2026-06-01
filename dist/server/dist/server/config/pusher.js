"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const pusher_1 = __importDefault(require("pusher"));
const pusher = new pusher_1.default({
    appId: '1862105',
    key: '9a62ef4d6',
    secret: '0a953af',
    cluster: 'ap2',
    useTLS: true,
    port: 443
});
exports.default = pusher;
