import mongoose from 'mongoose';
import ProductionGroup from './models/ProductionGroup.js';
import { connectDB } from './config/database.js';

async function checkGroupNames() {
  try {
    await connectDB();
    
    console.log('📦 Checking Production Group Names...\n');
    
    const groups = await ProductionGroup.find({})
      .populate('company', 'name')
      .populate('items', 'name');
    
    console.log(`Found ${groups.length} production groups:\n`);
    
    groups.forEach((group, index) => {
      console.log(`${index + 1}. Group Name: "${group.groupName}"`);
      console.log(`   Company: ${group.company?.name || 'N/A'}`);
      console.log(`   Items: ${group.items?.length || 0}`);
      console.log(`   Active: ${group.isActive}`);
      console.log('');
    });
    
    // Check for typos
    const possibleTypos = groups.filter(g => 
      g.groupName.toLowerCase().includes('broun') ||
      g.groupName.toLowerCase().includes('boun')
    );
    
    if (possibleTypos.length > 0) {
      console.log('\n⚠️  Groups with "broun" or "boun":');
      possibleTypos.forEach(g => {
        console.log(`   - "${g.groupName}"`);
      });
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkGroupNames();
