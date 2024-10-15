const { ethers } = require("ethers");
const axios = require("axios");
const readline = require("readline");
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
const ITERATIONS = 40; // Loop Process TX [40 Loop for doing 80tx] MAX CAP AT 75x TX
const ITERATION_DELAY = 2 * 60 * 1000; // 2 minutes in milliseconds
const WALLET_COMPLETION_DELAY = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
let FIXED_AMOUNT;
let MIN_AMOUNT;
let MAX_AMOUNT;
let useRandomAmount;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function setupAmountConfig() {
  const choice = await askQuestion("Choose an option:\n1. Use fixed amount\n2. Use random amount between min and max\nEnter your choice (1 or 2): ");

  if (choice === "1") {
    useRandomAmount = false;
    const fixedAmount = await askQuestion("Enter the fixed amount in ETH: ");
    FIXED_AMOUNT = ethers.parseEther(fixedAmount);
  } else if (choice === "2") {
    useRandomAmount = true;
    const minAmount = await askQuestion("Enter the minimum amount in ETH: ");
    const maxAmount = await askQuestion("Enter the maximum amount in ETH: ");
    MIN_AMOUNT = ethers.parseEther(minAmount);
    MAX_AMOUNT = ethers.parseEther(maxAmount);
  } else {
    console.log("Invalid choice. Please run the script again.");
    process.exit(1);
  }

  rl.close();
}

function getRandomAmount() {
  const minWei = BigInt(MIN_AMOUNT);
  const maxWei = BigInt(MAX_AMOUNT);
  const range = maxWei - minWei;
  const randomBigInt = BigInt(Math.floor(Math.random() * Number(range)));
  return minWei + randomBigInt;
}

function getAmount() {
  if (useRandomAmount) {
    return getRandomAmount();
  } else {
    return FIXED_AMOUNT;
  }
}

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

    const amount = getAmount();
    console.log(`Using ${useRandomAmount ? 'random' : 'fixed'} amount: ${ethers.formatEther(amount)} ETH`);

    const { ethBalance } = await getBalances(provider, wethContract, wallet.address);
    if (ethBalance >= amount) {
      await wrapETH(wethContract, amount);
      await logBalances(provider, wethContract, wallet.address, "after wrapping");
    } else {
      console.log(`Insufficient ETH balance for wrapping. Need ${ethers.formatEther(amount)} ETH.`);
      return false;
    }

    const { wethBalance } = await getBalances(provider, wethContract, wallet.address);
    if (wethBalance >= amount) {
      await unwrapETH(wethContract, amount);
      await logBalances(provider, wethContract, wallet.address, "after unwrapping");
    } else {
      console.log(`Insufficient WETH balance for unwrapping. Need ${ethers.formatEther(amount)} WETH.`);
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
  await setupAmountConfig();

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