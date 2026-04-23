import Customer from '../models/Customer.js';
import { resetCustomerCollection } from '../utils/resetCustomerCollection.js';

const customerData = [
  {
    customerName: "Rajesh Electronics",
    customerType: "Retail",
    status: "Active",
    contactName: "Rajesh Kumar",
    mobile: "9876543210",
    email: "rajesh@electronics.com",
    addressLine1: "123 Electronics Market, Brigade Road",
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    pin: "560001",
    notes: "Regular customer, prefers cash payments",
    creditLimit: 50000,
    outstandingAmount: 12500
  },
  {
    customerName: "Mumbai Wholesale Traders",
    customerType: "Wholesale",
    status: "Active",
    contactName: "Priya Sharma",
    mobile: "9123456789",
    email: "priya@mumbaitraders.com",
    addressLine1: "456 Wholesale Complex, Andheri East",
    city: "Mumbai",
    state: "Maharashtra",
    country: "India",
    pin: "400069",
    notes: "Bulk orders, 30-day payment terms",
    creditLimit: 200000,
    outstandingAmount: 85000
  },
  {
    customerName: "Global Export House",
    customerType: "Export",
    status: "Active",
    contactName: "Sunita Reddy",
    mobile: "9445566778",
    email: "sunita@globalexport.com",
    addressLine1: "321 Export Zone, HITEC City",
    city: "Hyderabad",
    state: "Telangana",
    country: "India",
    pin: "500081",
    notes: "Export customer, requires detailed documentation",
    creditLimit: 500000,
    outstandingAmount: 125000
  },
  {
    customerName: "TechnoVision Systems",
    customerType: "Distributor",
    status: "Active",
    contactName: "Amit Patel",
    mobile: "9988776655",
    email: "amit@technovision.in",
    addressLine1: "789 Tech Park, Cyber City",
    city: "Gurgaon",
    state: "Haryana",
    country: "India",
    pin: "122002",
    notes: "Technology distributor, prefers electronic payments",
    creditLimit: 150000,
    outstandingAmount: 45000
  },
  {
    customerName: "Chennai Manufacturing Co.",
    customerType: "Manufacturer",
    status: "Active",
    contactName: "Ravi Krishnan",
    mobile: "9876512345",
    email: "ravi@chennaimanuf.com",
    addressLine1: "654 Industrial Estate, Guindy",
    city: "Chennai",
    state: "Tamil Nadu",
    country: "India",
    pin: "600032",
    notes: "Manufacturing partner, regular monthly orders",
    creditLimit: 300000,
    outstandingAmount: 75000
  },
  {
    customerName: "Delhi Distributors",
    customerType: "Distributor",
    status: "Active",
    contactName: "Neha Gupta",
    mobile: "9876123456",
    email: "neha@delhidist.com",
    addressLine1: "111 Commercial Complex, Connaught Place",
    city: "New Delhi",
    state: "Delhi",
    country: "India",
    pin: "110001",
    notes: "Premium distributor, handles North region",
    creditLimit: 250000,
    outstandingAmount: 60000
  },
  {
    customerName: "Kolkata Retail Chain",
    customerType: "Retail",
    status: "Active",
    contactName: "Subrata Roy",
    mobile: "9876789012",
    email: "subrata@kolkataretail.com",
    addressLine1: "222 Market Street, Park Street",
    city: "Kolkata",
    state: "West Bengal",
    country: "India",
    pin: "700016",
    notes: "Multiple retail outlets, weekly orders",
    creditLimit: 100000,
    outstandingAmount: 25000
  },
  {
    customerName: "Pune Tech Solutions",
    customerType: "Retail",
    status: "Active",
    contactName: "Vikram Joshi",
    mobile: "9876234567",
    email: "vikram@punetech.com",
    addressLine1: "333 IT Park, Hinjewadi",
    city: "Pune",
    state: "Maharashtra",
    country: "India",
    pin: "411057",
    notes: "Technology retail, prefers latest products",
    creditLimit: 80000,
    outstandingAmount: 15000
  },
  {
    customerName: "Jaipur Heritage Stores",
    customerType: "Retail",
    status: "Active",
    contactName: "Rajesh Agarwal",
    mobile: "9876345678",
    email: "rajesh@jaipurheritage.com",
    addressLine1: "444 Pink City Market, MI Road",
    city: "Jaipur",
    state: "Rajasthan",
    country: "India",
    pin: "302001",
    notes: "Heritage store, traditional products preferred",
    creditLimit: 75000,
    outstandingAmount: 20000
  },
  {
    customerName: "Ahmedabad Export Co.",
    customerType: "Export",
    status: "Active",
    contactName: "Kiran Patel",
    mobile: "9876456789",
    email: "kiran@ahmedabadexport.com",
    addressLine1: "555 Export House, CG Road",
    city: "Ahmedabad",
    state: "Gujarat",
    country: "India",
    pin: "380009",
    notes: "Major export customer, international quality requirements",
    creditLimit: 400000,
    outstandingAmount: 95000
  },
  {
    customerName: "Coimbatore Industries",
    customerType: "Manufacturer",
    status: "Active",
    contactName: "Arjun Murugan",
    mobile: "9876567890",
    email: "arjun@coimbatoreindustries.com",
    addressLine1: "666 Industrial Area, Peelamedu",
    city: "Coimbatore",
    state: "Tamil Nadu",
    country: "India",
    pin: "641004",
    notes: "Industrial manufacturer, bulk raw material orders",
    creditLimit: 350000,
    outstandingAmount: 80000
  },
  {
    customerName: "Kochi Marine Supplies",
    customerType: "Wholesale",
    status: "Active",
    contactName: "Pradeep Nair",
    mobile: "9876678901",
    email: "pradeep@kochimarine.com",
    addressLine1: "777 Marine Drive, Fort Kochi",
    city: "Kochi",
    state: "Kerala",
    country: "India",
    pin: "682001",
    notes: "Marine industry supplier, seasonal orders",
    creditLimit: 180000,
    outstandingAmount: 40000
  },
  {
    customerName: "Lucknow Traditional Crafts",
    customerType: "Retail",
    status: "Inactive",
    contactName: "Anjali Srivastava",
    mobile: "9876789123",
    email: "anjali@lucknowcrafts.com",
    addressLine1: "888 Chowk Area, Aminabad",
    city: "Lucknow",
    state: "Uttar Pradesh",
    country: "India",
    pin: "226018",
    notes: "Traditional crafts retailer, currently inactive due to expansion",
    creditLimit: 60000,
    outstandingAmount: 5000
  },
  {
    customerName: "Chandigarh Modern Stores",
    customerType: "Retail",
    status: "Active",
    contactName: "Harpreet Singh",
    mobile: "9876890234",
    email: "harpreet@chandigarhmodern.com",
    addressLine1: "999 Sector 17, City Centre",
    city: "Chandigarh",
    state: "Punjab",
    country: "India",
    pin: "160017",
    notes: "Modern retail chain, premium products focus",
    creditLimit: 120000,
    outstandingAmount: 30000
  },
  {
    customerName: "Bhopal Central Suppliers",
    customerType: "Wholesale",
    status: "Active",
    contactName: "Mahesh Sharma",
    mobile: "9876901345",
    email: "mahesh@bhopalcentral.com",
    addressLine1: "101 Central Market, MP Nagar",
    city: "Bhopal",
    state: "Madhya Pradesh",
    country: "India",
    pin: "462011",
    notes: "Central India distributor, serves multiple states",
    creditLimit: 220000,
    outstandingAmount: 65000
  }
];

export const seedCustomers = async () => {
  try {
    console.log('Starting customer seeding process...');
    
    // Reset the collection first
    await resetCustomerCollection();
    console.log('Collection reset completed');
    
    // Wait a moment for the reset to complete
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('Creating customers...');
    const customers = [];
    
    for (const item of customerData) {
      try {
        const customer = new Customer(item);
        await customer.save();
        customers.push(customer);
        console.log(`Created customer: ${customer.customerName} (Code: ${customer.customerCode})`);
      } catch (error) {
        console.error(`Error creating customer ${item.customerName}:`, error.message);
      }
    }
    
    console.log(`Successfully created ${customers.length} customers`);
    return {
      success: true,
      message: `Successfully seeded ${customers.length} customers`,
      customers
    };
  } catch (error) {
    console.error('Error seeding customers:', error);
    throw error;
  }
};

// Export route handler
export const seedCustomersRoute = async (req, res) => {
  try {
    const result = await seedCustomers();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error seeding customers',
      error: error.message
    });
  }
};