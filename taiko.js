const { ethers } = require("ethers");
const axios = require("axios");
require("dotenv").config();

const provider = new ethers.JsonRpcProvider("https://rpc.taiko.xyz");

const wallets = [
  {
    address: process.env.ADDRESS,
    privateKey: process.env.PRIVATE_KEY,
  },
];

const WETH_ADDRESS = "0xa51894664a773981c6c112c43ce576f315d5b1b6";
const WETH_ABI = [
  "function deposit() public payable",
  "function withdraw(uint wad) public",
  "function balanceOf(address owner) view returns (uint256)",
];

const FIXED_GAS_PRICE = ethers.parseUnits("0.2", "gwei");
const AMOUNT = ethers.parseEther("0.01"); // Amount to wrap/unwrap for TX Value
const ITERATIONS = 2; // Loop Process TX
const ITERATION_DELAY = 2 * 60 * 1000; // 2 minutes in milliseconds
const WALLET_COMPLETION_DELAY = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

async function getBalances(provider, wethContract, address) {
  const [ethBalance, wethBalance] = await Promise.all([
    provider.getBalance(address),
    wethContract.balanceOf(address),
  ]);
  return { ethBalance, wethBalance };
}

async function logBalances(provider, wethContract, address, stage) {
  const { ethBalance, wethBalance } = await getBalances(provider, wethContract, address);
  console.log(`\n--- Balances at ${stage} ---`);
  console.log(`ETH balance: ${ethers.formatEther(ethBalance)} ETH`);
  console.log(`WETH balance: ${ethers.formatEther(wethBalance)} WETH`);
}

async function wrapETH(wethContract, amount) {
  console.log(`\nWrapping ${ethers.formatEther(amount)} ETH to WETH...`);
  const tx = await wethContract.deposit({ value: amount, gasPrice: FIXED_GAS_PRICE });
  await tx.wait();
  console.log("Wrap complete.");
}

async function unwrapETH(wethContract, amount) {
  console.log(`\nUnwrapping ${ethers.formatEther(amount)} WETH to ETH...`);
  const tx = await wethContract.withdraw(amount, { gasPrice: FIXED_GAS_PRICE });
  await tx.wait();
  console.log("Unwrap complete.");
}

async function performWrapAndUnwrap(wallet, iteration) {
  console.log(`\n=== Processing wallet: ${wallet.address} (Iteration ${iteration + 1}/${ITERATIONS}) ===`);
  const walletInstance = new ethers.Wallet(wallet.privateKey, provider);
  const wethContract = new ethers.Contract(WETH_ADDRESS, WETH_ABI, walletInstance);

  try {
    await logBalances(provider, wethContract, wallet.address, "start");

    const { ethBalance } = await getBalances(provider, wethContract, wallet.address);
    if (ethBalance >= AMOUNT) {
      await wrapETH(wethContract, AMOUNT);
      await logBalances(provider, wethContract, wallet.address, "after wrapping");
    } else {
      console.log(`Insufficient ETH balance for wrapping. Need ${ethers.formatEther(AMOUNT)} ETH.`);
      return false;
    }

    const { wethBalance } = await getBalances(provider, wethContract, wallet.address);
    if (wethBalance >= AMOUNT) {
      await unwrapETH(wethContract, AMOUNT);
      await logBalances(provider, wethContract, wallet.address, "after unwrapping");
    } else {
      console.log(`Insufficient WETH balance for unwrapping. Need ${ethers.formatEther(AMOUNT)} WETH.`);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`Error in wrap/unwrap process for ${wallet.address}: ${error.message}`);
    console.error("Error stack:", error.stack);
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processWallet(wallet) {
  console.log(`\n\n=== Starting process for wallet: ${wallet.address} ===`);
  for (let i = 0; i < ITERATIONS; i++) {
    const success = await performWrapAndUnwrap(wallet, i);
    if (!success) {
      console.log(`Stopping process for wallet ${wallet.address} due to error or insufficient funds.`);
      return false;
    }
    
    if (i < ITERATIONS - 1) {
      console.log(`Waiting for ${ITERATION_DELAY / 60000} minutes before the next iteration...`);
      await sleep(ITERATION_DELAY);
    }
  }
  return true;
}

async function main() {
  while (true) {
    for (const wallet of wallets) {
      const success = await processWallet(wallet);
      if (success) {
        console.log(`\n=== Completed all iterations for wallet: ${wallet.address} ===`);
      }
      console.log(`Waiting for 24 hours before processing the wallet again...`);
      await sleep(WALLET_COMPLETION_DELAY);
    }
    console.log("\n=== Completed processing all wallets. Starting over... ===\n");
  }
}

main().catch((error) => {
  console.error("Unhandled error in main function:", error);
  process.exit(1);
});