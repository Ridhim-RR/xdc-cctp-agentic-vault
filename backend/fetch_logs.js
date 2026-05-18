const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
    try {
        const provider = new ethers.JsonRpcProvider(process.env.XDC_TESTNET_RPC);
        const vaultAddress = process.env.VAULT_ADDRESS;
        
        if (!vaultAddress || !process.env.XDC_TESTNET_RPC) {
            console.error("Missing environment variables VAULT_ADDRESS or XDC_TESTNET_RPC");
            process.exit(1);
        }

        const currentBlock = await provider.getBlockNumber();
        const fromBlock = currentBlock - 10000; // Increased range
        
        // Let's try more common signatures
        const signatures = [
            "Deposited(address,uint256,uint256)",
            "Deposited(address,uint256)",
            "Deposit(address,uint256,uint256)",
            "Deposit(address,uint256)"
        ];

        console.log("Current Block:", currentBlock);
        console.log("Vault Address:", vaultAddress);

        for (const sig of signatures) {
            const topic = ethers.id(sig);
            console.log(`Checking signature: ${sig} (${topic})`);
            const logs = await provider.getLogs({
                address: vaultAddress,
                fromBlock: fromBlock,
                toBlock: "latest",
                topics: [topic]
            });

            if (logs.length > 0) {
                console.log(`Found ${logs.length} logs for ${sig}`);
                console.log("Latest 5 Tx Hashes with Block Numbers:");
                const latestLogs = logs.slice(-5).reverse();
                latestLogs.forEach(log => {
                    console.log(`Hash: ${log.transactionHash}, Block: ${log.blockNumber}`);
                });
                return;
            }
        }
        
        console.log("Count: 0");

    } catch (error) {
        console.error("Error encountered:", error.message);
    }
}

main();
