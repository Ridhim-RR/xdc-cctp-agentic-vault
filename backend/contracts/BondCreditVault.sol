// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title BondCreditVault
 * @notice Vault for USDC deposits with owner-controlled bridge transfer support.
 * @dev The owner is expected to be the backend operational key (or a multisig in production).
 */
contract BondCreditVault is Ownable {
    /// @dev ERC20 token handled by this vault (USDC)
    IERC20 public immutable usdc;

    /// @dev Per-user accounting snapshot
    mapping(address => uint256) public balances;

    /// @dev Total USDC currently tracked inside the vault accounting
    uint256 public totalDeposits;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event BridgeTransferInitiated(address indexed bridgeWallet, uint256 amount);

    constructor(address _usdc) {
        require(_usdc != address(0), "USDC address cannot be zero");
        usdc = IERC20(_usdc);
    }

    function deposit(uint256 amount) external {
        require(amount > 0, "Deposit amount must be > 0");

        bool ok = usdc.transferFrom(msg.sender, address(this), amount);
        require(ok, "USDC transferFrom failed");

        balances[msg.sender] += amount;
        totalDeposits += amount;

        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        require(amount > 0, "Withdraw amount must be > 0");

        uint256 userBalance = balances[msg.sender];
        require(userBalance >= amount, "Insufficient balance");

        balances[msg.sender] = userBalance - amount;
        totalDeposits -= amount;

        bool ok = usdc.transfer(msg.sender, amount);
        require(ok, "USDC transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice Move USDC from vault custody to bridge wallet for CCTP burn orchestration.
     * @dev onlyOwner so arbitrary users cannot drain vault funds.
     * @param bridgeWallet Backend-controlled bridge wallet address.
     * @param amount USDC amount to transfer.
     */
    function transferToBridgeWallet(address bridgeWallet, uint256 amount) external onlyOwner {
        require(bridgeWallet != address(0), "Invalid bridge wallet");
        require(amount > 0, "Amount must be > 0");
        require(amount <= totalDeposits, "Insufficient vault accounting balance");

        uint256 vaultUsdcBalance = usdc.balanceOf(address(this));
        require(vaultUsdcBalance >= amount, "Insufficient vault USDC balance");

        // Funds leave vault custody for bridge orchestration; reflect that in vault-side aggregate.
        totalDeposits -= amount;

        bool ok = usdc.transfer(bridgeWallet, amount);
        require(ok, "USDC transfer to bridge wallet failed");

        emit BridgeTransferInitiated(bridgeWallet, amount);
    }

    function getBalance(address user) external view returns (uint256) {
        return balances[user];
    }
}
