import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  maxUint256,
  parseAbi,
  parseEther,
  zeroAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  getBlockExplorerUrl,
  getChainConfigFromChainId,
  sanitizePrivateKey,
  delay,
  getRpcUrl,
} from '../../src/utils/helpers';
import {
  getChainBaseStake,
  getChainStakeToken,
  getChainNativeToken,
  getChainConfiguration,
  getChainInformation,
} from '../../src/utils/chain-info-helpers';
import 'dotenv/config';

// Check for required env variables
if (
  !process.env.DEPLOYER_PRIVATE_KEY ||
  !process.env.BATCH_POSTER_PRIVATE_KEY ||
  !process.env.STAKER_PRIVATE_KEY
) {
  throw new Error(
    'The following environment variables must be present: DEPLOYER_PRIVATE_KEY, BATCH_POSTER_PRIVATE_KEY, STAKER_PRIVATE_KEY',
  );
}

// Get chain configuration
const arbitrumChainConfig = getChainConfiguration();

// Load accounts
const deployer = privateKeyToAccount(sanitizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY));
const batchPosterAddress = privateKeyToAccount(
  sanitizePrivateKey(process.env.BATCH_POSTER_PRIVATE_KEY),
).address;
const validatorAddress = privateKeyToAccount(
  sanitizePrivateKey(process.env.STAKER_PRIVATE_KEY),
).address;

// Set the parent chain and create a wallet client for it
const parentChainId = Number(arbitrumChainConfig['parent-chain-id']);
const parentChainInformation = getChainConfigFromChainId(parentChainId);
const parentChainWalletClient = createWalletClient({
  account: deployer,
  chain: parentChainInformation,
  transport: http(process.env.PARENT_CHAIN_RPC_URL || getRpcUrl(parentChainInformation)),
});
const parentChainPublicClient = createPublicClient({
  chain: parentChainInformation,
  transport: http(process.env.PARENT_CHAIN_RPC_URL || getRpcUrl(parentChainInformation)),
});

const chainInformation = getChainInformation();
const arbitrumChainPublicClient = createPublicClient({
  chain: chainInformation,
  transport: http(),
});

// Amount constants
const fundingAmount = process.env.FUNDING_AMOUNT || '0.3';

const main = async () => {
  console.log('******************************');
  console.log('* Arbitrum chain initializer *');
  console.log('******************************');
  console.log('');

  //
  // Funding the batch poster and staker accounts in the parent chain
  //
  const fundingAmountWei = parseEther(fundingAmount);

  console.log(`Fund batch poster account on parent chain with ${fundingAmount} ETH...`);
  const currentBatchPosterBalance = await parentChainPublicClient.getBalance({
    address: batchPosterAddress,
  });
  if (currentBatchPosterBalance >= fundingAmountWei) {
    console.log(
      `Batch poster already funded (balance: ${formatEther(
        currentBatchPosterBalance,
      )}). Skipping...`,
    );
  } else {
    const fundBatchPosterTxHash = await parentChainWalletClient.sendTransaction({
      to: batchPosterAddress,
      value: fundingAmountWei,
    });
    console.log(
      `Done! Transaction hash on parent chain: ${getBlockExplorerUrl(
        parentChainInformation,
      )}/tx/${fundBatchPosterTxHash}`,
    );
    // NOTE: it looks like viem is not handling the nonce correctly when making calls this quickly.
    // Adding a delay of 10 seconds solves this issue.
    await delay(10 * 1000);
  }

  console.log(`Fund staker account on parent chain with ${fundingAmount} ETH...`);
  const currentStakerBalance = await parentChainPublicClient.getBalance({
    address: validatorAddress,
  });
  if (currentStakerBalance >= fundingAmountWei) {
    console.log(
      `Staker already funded (balance: ${formatEther(currentStakerBalance)}). Skipping...`,
    );
  } else {
    const fundStakerTxHash = await parentChainWalletClient.sendTransaction({
      to: validatorAddress,
      value: fundingAmountWei,
    });
    console.log(
      `Done! Transaction hash on parent chain: ${getBlockExplorerUrl(
        parentChainInformation,
      )}/tx/${fundStakerTxHash}`,
    );
    // NOTE: it looks like viem is not handling the nonce correctly when making calls this quickly.
    // Adding a delay of 10 seconds solves this issue.
    await delay(10 * 1000);
  }

  const stakeToken = await getChainStakeToken(parentChainPublicClient);
  const baseStakeWei = await getChainBaseStake(parentChainPublicClient);
  console.log(
    `Fund staker account on parent chain with ${formatEther(
      baseStakeWei,
    )} stake token (${stakeToken})...`,
  );
  const currentStakeTokenBalance = await parentChainPublicClient.readContract({
    address: stakeToken,
    abi: parseAbi(['function balanceOf(address) public view returns (uint256)']),
    functionName: 'balanceOf',
    args: [validatorAddress],
  });
  if (currentStakeTokenBalance >= baseStakeWei) {
    console.log(
      `Staker already funded with stake token (balance: ${formatEther(
        currentStakeTokenBalance,
      )}). Skipping...`,
    );
  } else {
    const { request: fundStakeTokenTxRequest } = await parentChainPublicClient.simulateContract({
      account: parentChainWalletClient.account,
      address: stakeToken,
      abi: parseAbi(['function deposit() public payable']),
      functionName: 'deposit',
      value: baseStakeWei,
    });
    const fundStakeTokenTxHash = await parentChainWalletClient.writeContract(
      fundStakeTokenTxRequest,
    );
    console.log(
      `Done! Transaction hash on parent chain: ${getBlockExplorerUrl(
        parentChainInformation,
      )}/tx/${fundStakeTokenTxHash}`,
    );
    // NOTE: it looks like viem is not handling the nonce correctly when making calls this quickly.
    // Adding a delay of 10 seconds solves this issue.
    await delay(10 * 1000);

    const { request: transferStakeTokenTxRequest } = await parentChainPublicClient.simulateContract(
      {
        account: parentChainWalletClient.account,
        address: stakeToken,
        abi: parseAbi(['function transfer(address,uint256) public payable']),
        functionName: 'transfer',
        args: [validatorAddress, baseStakeWei],
      },
    );
    const transferStakeTokenTxHash = await parentChainWalletClient.writeContract(
      transferStakeTokenTxRequest,
    );
    console.log(
      `Done! Transaction hash on parent chain: ${getBlockExplorerUrl(
        parentChainInformation,
      )}/tx/${transferStakeTokenTxHash}`,
    );
    // NOTE: it looks like viem is not handling the nonce correctly when making calls this quickly.
    // Adding a delay of 10 seconds solves this issue.
    await delay(10 * 1000);
  }

  //
  // Funding the deployer account in the Arbitrum chain
  //
  console.log(`Fund deployer account on Arbitrum chain with ${fundingAmount} ETH...`);
  const startBalance = await arbitrumChainPublicClient.getBalance({
    address: deployer.address,
  });
  if (startBalance >= fundingAmountWei) {
    console.log(
      `Deployer account already funded (balance: ${formatEther(startBalance)}). Skipping...`,
    );
  } else {
    // Check for native token
    const nativeToken = getChainNativeToken();

    if (nativeToken != zeroAddress) {
      // Approve native token to deposit through inbox
      console.log('Approving the native token to deposit through inbox');
      const { request: approvalRequest } = await parentChainPublicClient.simulateContract({
        account: deployer,
        address: nativeToken,
        abi: parseAbi(['function approve(address,uint256) public payable']),
        functionName: 'approve',
        args: [arbitrumChainConfig.rollup.inbox, maxUint256],
      });

      const approvalTxHash = await parentChainWalletClient.writeContract(approvalRequest);
      console.log(
        `Done! Transaction hash on parent chain: ${getBlockExplorerUrl(
          parentChainInformation,
        )}/tx/${approvalTxHash}`,
      );

      const { request } = await parentChainPublicClient.simulateContract({
        account: deployer,
        address: arbitrumChainConfig.rollup.inbox,
        abi: parseAbi(['function depositERC20(uint256) public payable']),
        functionName: 'depositERC20',
        args: [fundingAmountWei],
      });

      const fundDeployerTxHash = await parentChainWalletClient.writeContract(request);
      console.log(
        `Done! Transaction hash on parent chain: ${getBlockExplorerUrl(
          parentChainInformation,
        )}/tx/${fundDeployerTxHash}`,
      );
    } else {
      const { request } = await parentChainPublicClient.simulateContract({
        account: deployer,
        address: arbitrumChainConfig.rollup.inbox,
        abi: parseAbi(['function depositEth() public payable']),
        functionName: 'depositEth',
        value: fundingAmountWei,
      });

      const fundDeployerTxHash = await parentChainWalletClient.writeContract(request);
      console.log(
        `Done! Transaction hash on parent chain: ${getBlockExplorerUrl(
          parentChainInformation,
        )}/tx/${fundDeployerTxHash}`,
      );
    }

    // Wait for balance to be updated
    console.log(
      `Waiting for funds to arrive to the Arbitrum chain (it might take a few minutes)...`,
    );
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const currentBalance = await arbitrumChainPublicClient.getBalance({
        address: deployer.address,
      });
      if (currentBalance - startBalance >= fundingAmountWei) {
        console.log(`Deployer account has been funded on the Arbitrum chain.`);
        break;
      }

      // eslint-disable-next-line no-await-in-loop
      await delay(30 * 1000);
    }
  }
};

// Calling main
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
