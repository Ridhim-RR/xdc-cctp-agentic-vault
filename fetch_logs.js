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
        const fromBlock = currentBlock - 5000;
        
        // Deposited(address,uint256)
        // Usually, the event name is "Deposited"
        // Let's assume standard ERC20-like or Vault Deposit event topic.
        // We'll use the event signature if known, or just filter by vault address and a common topic.
        const eventTopic = ethers.id("Deposited(address,uint256)");

        console.log("Current Block:", currentBlock);
        console.log("Vault Address:", vaultAddress);
        console.log("Event Topic:", eventTopic);

        const logs = await provider.getLogs({
            address: vaultAddress,
            fromBlock: fromBlock,
            toBlock: "latest",
            topics: [eventTopic]
        });

        console.log("Count:", logs.length);
        
        const latestLogs = logs.slice(-5).reverse();
        console.log("Latest 5 Tx Hashes with Block Numbers:");
        latestLogs.forEach(log => {
            console.log(`Hash: ${log.transactionHash}, Block: ${log.blockNumber}`);
        });

    } catch (error) {
        console.error("Error encountered:", error);
    }
}

main();
