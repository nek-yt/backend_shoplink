// Adds a few sample products if the catalog is empty: npm run seed
import { PrismaPg } from '@prisma/adapter-pg';
import { loadConfig } from '../src/config';
import { PrismaClient } from '../src/generated/prisma/client';

const SAMPLES = [
  { name: 'Oversize Hoodie', description: 'Warm cotton hoodie with a kangaroo pocket', price: 249000, rating: 4.7, stock: 25, sizes: ['S', 'M', 'L', 'XL'], colors: ['black', 'beige'] },
  { name: 'Basic T-Shirt', description: '100% cotton, regular fit', price: 89000, rating: 4.5, stock: 120, sizes: ['S', 'M', 'L'], colors: ['white', 'black', 'grey'] },
  { name: 'Wide Leg Jeans', description: 'High waist, relaxed fit', price: 319000, rating: 4.3, stock: 14, sizes: ['26', '28', '30', '32'], colors: ['blue'] },
  { name: 'Leather Tote Bag', description: 'Genuine leather, fits a 14" laptop', price: 459000, rating: 4.9, stock: 6, sizes: [], colors: ['brown', 'black'] },
];

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: loadConfig().databaseUrl }) });
  try {
    const count = await prisma.product.count();
    if (count > 0) {
      console.log(`Catalog already has ${count} products, nothing to do.`);
      return;
    }
    await prisma.product.createMany({
      data: SAMPLES.map(({ price, ...p }) => ({ ...p, priceCents: BigInt(Math.round(price * 100)) })),
    });
    console.log(`Added ${SAMPLES.length} sample products.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`Seed failed: ${err.message}`);
  process.exit(1);
});
