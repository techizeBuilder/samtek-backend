// This file implements a MongoDB-based storage interface
// Since we're using MongoDB with Mongoose, we don't need the MemStorage implementation
// All CRUD operations are handled directly through the Mongoose models in controllers

export interface IStorage {
  // This interface is kept for compatibility but not used
  // All database operations are handled by Mongoose models directly
}

export class MongoStorage implements IStorage {
  constructor() {
    console.log('Using MongoDB storage with Mongoose ODM');
  }
}

export const storage = new MongoStorage();
