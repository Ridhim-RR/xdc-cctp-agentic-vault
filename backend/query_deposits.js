const { PrismaClient } = require("@prisma/client");
require("dotenv").config();

async function main() {
  const prisma = new PrismaClient();
  try {
    const deposits = await prisma.deposit.findMany({
      take: 10,
      orderBy: {
        blockNumber: 'desc',
      },
      select: {
        txHash: true,
        blockNumber: true,
        createdAt: true,
      },
    });

    if (deposits.length === 0) {
      console.log("No deposits found.");
    } else {
      deposits.forEach((d) => {
        console.log(`txHash: ${d.txHash}, blockNumber: ${d.blockNumber}, createdAt: ${d.createdAt}`);
      });
    }
  } catch (error) {
    console.error("Database connection error:", error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
