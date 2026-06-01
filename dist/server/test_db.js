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
const mongoose = require('mongoose');
mongoose.connect('mongodb://admin:thinkprolms989@193.203.161.214:27004/samtek-erp?authSource=admin').then(() => __awaiter(void 0, void 0, void 0, function* () { const db = mongoose.connection.db; const users = yield db.collection('users').find({}).toArray(); console.log(users.map(u => ({ username: u.username, role: u.role }))); mongoose.disconnect(); }));
